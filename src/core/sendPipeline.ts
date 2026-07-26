import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  accounts,
  contactedRegistry,
  contacts,
  leads,
  messages,
  users,
} from '@/db/schema';
import type { Tx } from '@/db/client';
import { loadBatchInputs, planBatch, type BatchPlan } from './batch';
import { draftFirstTouch, type Signal } from './personalization';
import { audit, trace } from '@/lib/audit';
import { planFollowUps } from './cadence';
import { followUps } from '@/db/schema';

/**
 * Turns a batch plan into `pending_approval` messages (spec Fase 1:
 * "borradores con aprobación humana").
 *
 * Nothing in this file talks to Gmail. Drafting and sending are separated on
 * purpose: a draft is reversible and cheap to review, a send is neither, so the
 * transition between them is the human checkpoint required by §10.
 */

export type PreparedBatch = {
  campaignKey: string;
  prepared: number;
  skipped: BatchPlan['skipped'];
  capacity: number;
  messageIds: string[];
};

export async function prepareTodaysBatch(
  tx: Tx,
  args: {
    orgId: string;
    userId: string;
    campaignKey: string;
    limit?: number;
  },
): Promise<PreparedBatch> {
  const inputs = await loadBatchInputs(
    tx,
    args.orgId,
    args.campaignKey,
    args.limit ?? 200,
  );
  const plan = planBatch({ campaignKey: args.campaignKey, ...inputs });

  // Record every block, not just the sends. The skip list is how we show that
  // suppression and anti-resend ran on a given day.
  for (const skip of plan.skipped) {
    await trace(tx, {
      orgId: args.orgId,
      agentKey: 'sender',
      tool: 'create_todays_batch',
      outcome: 'blocked',
      blockedReason: `${skip.reason}: ${skip.detail}`,
      input: { leadId: skip.leadId },
    });
  }

  if (plan.planned.length === 0) {
    return {
      campaignKey: args.campaignKey,
      prepared: 0,
      skipped: plan.skipped,
      capacity: plan.capacity,
      messageIds: [],
    };
  }

  const leadIds = plan.planned.map((p) => p.leadId);
  const detailRows = await tx
    .select({
      leadId: leads.id,
      language: leads.language,
      signal: leads.signal,
      fullName: contacts.fullName,
      title: contacts.title,
      company: accounts.name,
    })
    .from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .leftJoin(accounts, eq(accounts.id, leads.accountId))
    .where(and(eq(leads.orgId, args.orgId), inArray(leads.id, leadIds)));

  const details = new Map(detailRows.map((d) => [d.leadId, d]));

  const [sender] = await tx
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, args.userId))
    .limit(1);

  const messageIds: string[] = [];

  for (const entry of plan.planned) {
    const detail = details.get(entry.leadId);
    if (!detail) continue;

    const draft = await draftFirstTouch({
      contactName: detail.fullName,
      contactTitle: detail.title,
      companyName: detail.company ?? 'your team',
      language: (detail.language as 'en' | 'es' | 'pt') ?? 'en',
      signal: (detail.signal as Signal | null) ?? null,
      senderName: sender?.name ?? 'DevUps',
      variantKey: pickVariant(entry.leadId),
    });

    const [row] = await tx
      .insert(messages)
      .values({
        orgId: args.orgId,
        leadId: entry.leadId,
        mailboxId: entry.mailboxId,
        assignedUserId: args.userId,
        channel: 'email',
        direction: 'outbound',
        subject: draft.subject,
        body: draft.body,
        // Never 'queued'. A human moves it forward.
        status: 'pending_approval',
        dedupeKey: entry.dedupeKey,
        sequenceStep: entry.step,
        variantKey: pickVariant(entry.leadId),
      })
      // The unique index on (org_id, dedupe_key) is the real idempotency
      // guarantee; this makes a retry a no-op instead of an error.
      .onConflictDoNothing({ target: [messages.orgId, messages.dedupeKey] })
      .returning({ id: messages.id });

    if (row) messageIds.push(row.id);
  }

  await tx
    .update(leads)
    .set({ stage: 'queued', updatedAt: new Date() })
    .where(and(eq(leads.orgId, args.orgId), inArray(leads.id, leadIds)));

  await audit(tx, {
    orgId: args.orgId,
    actorUserId: args.userId,
    action: 'batch.prepared',
    meta: {
      campaignKey: args.campaignKey,
      prepared: messageIds.length,
      skipped: plan.skipped.length,
      capacity: plan.capacity,
    },
  });

  return {
    campaignKey: args.campaignKey,
    prepared: messageIds.length,
    skipped: plan.skipped,
    capacity: plan.capacity,
    messageIds,
  };
}

/** Stable per-lead A/B assignment so a lead keeps its variant across retries. */
export function pickVariant(leadId: string): string {
  let hash = 0;
  for (let i = 0; i < leadId.length; i++) {
    hash = (hash * 31 + leadId.charCodeAt(i)) >>> 0;
  }
  return hash % 2 === 0 ? 'A' : 'B';
}

/**
 * Marks an approved message as queued and records the contact in the
 * anti-resend registry. Called only from a human-approval path.
 */
export async function approveMessage(
  tx: Tx,
  args: { orgId: string; userId: string; messageId: string },
): Promise<{ queued: boolean; reason?: string }> {
  const [message] = await tx
    .select({
      id: messages.id,
      leadId: messages.leadId,
      mailboxId: messages.mailboxId,
      status: messages.status,
      contactEmail: contacts.email,
    })
    .from(messages)
    .innerJoin(leads, eq(leads.id, messages.leadId))
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .where(and(eq(messages.orgId, args.orgId), eq(messages.id, args.messageId)))
    .limit(1);

  if (!message) return { queued: false, reason: 'message not found' };
  if (message.status !== 'pending_approval') {
    return { queued: false, reason: `message is ${message.status}` };
  }

  await tx
    .update(messages)
    .set({ status: 'queued' })
    .where(eq(messages.id, message.id));

  // Register the touch now, at approval, so a concurrent batch cannot plan a
  // second message to the same address while this one is in flight.
  await tx
    .insert(contactedRegistry)
    .values({
      orgId: args.orgId,
      email: message.contactEmail,
      byMailboxId: message.mailboxId,
      source: 'engine',
    })
    .onConflictDoUpdate({
      target: [contactedRegistry.orgId, contactedRegistry.email],
      set: {
        lastContactedAt: new Date(),
        timesContacted: sql`${contactedRegistry.timesContacted} + 1`,
      },
    });

  for (const followUp of planFollowUps(new Date())) {
    await tx
      .insert(followUps)
      .values({
        orgId: args.orgId,
        leadId: message.leadId,
        step: followUp.step,
        dueAt: followUp.dueAt,
        status: 'pending',
      })
      .onConflictDoNothing({
        target: [followUps.orgId, followUps.leadId, followUps.step],
      });
  }

  await audit(tx, {
    orgId: args.orgId,
    actorUserId: args.userId,
    action: 'message.approved',
    resourceTable: 'messages',
    resourceId: message.id,
  });

  return { queued: true };
}

