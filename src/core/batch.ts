import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  accounts,
  contactedRegistry,
  contacts,
  domains,
  leads,
  mailboxes,
  messages,
  replies,
  suppression,
} from '@/db/schema';
import type { Tx } from '@/db/client';
import { checkSendEligibility, type BlockReason } from './eligibility';
import { sendDedupeKey } from './dedupe';
import { prioritize } from './scoring';
import {
  orgDailyCapacity,
  selectMailbox,
  type Mailbox,
  type WarmupStage,
} from './mailbox';
import { normalizeEmail } from './email';

/**
 * Builds the day's send batch (spec §5, MCP `create_todays_batch`).
 *
 * Nothing is sent here. The output is a set of `pending_approval` messages plus
 * an explicit list of who was skipped and why — during suggestion mode a human
 * approves the batch, and the skip list is the audit artifact that shows the
 * compliance gates actually ran.
 */

export type BatchCandidate = {
  leadId: string;
  contactId: string;
  accountId: string | null;
  email: string;
  score: number;
  optIn: boolean;
};

/** Per-account relationship state, keyed by account id. */
export type AccountState = {
  name: string;
  relationship: string;
  /**
   * Every lead on this account with its stage. Kept as pairs rather than a bare
   * stage list so a candidate can be excluded from its own sibling check — a
   * lead must not block itself.
   */
  leadStages: { leadId: string; stage: string }[];
};

export type BatchSkip = {
  leadId: string;
  email: string;
  reason: BlockReason | 'no_capacity';
  detail: string;
};

export type BatchPlanEntry = {
  leadId: string;
  email: string;
  mailboxId: string;
  dedupeKey: string;
  step: number;
};

export type BatchPlan = {
  campaignKey: string;
  planned: BatchPlanEntry[];
  skipped: BatchSkip[];
  capacity: number;
};

export type PlanInput = {
  campaignKey: string;
  candidates: readonly BatchCandidate[];
  mailboxes: readonly Mailbox[];
  suppressionEntries: readonly { value: string; reason: string }[];
  accounts: ReadonlyMap<string, AccountState>;
  registry: ReadonlyMap<
    string,
    { email: string; lastContactedAt: Date; timesContacted: number }
  >;
  existingKeys: ReadonlySet<string>;
  repliedLeadIds: ReadonlySet<string>;
  step?: number;
  now?: Date;
};

/**
 * Pure planning step. Kept free of I/O so the compliance ordering is directly
 * testable: suppression and anti-resend are evaluated for every candidate
 * before capacity is consulted, so a blocked lead never consumes a slot.
 */
export function planBatch(input: PlanInput): BatchPlan {
  const now = input.now ?? new Date();
  const step = input.step ?? 0;

  const mailboxState = input.mailboxes.map((m) => ({ ...m }));
  const capacity = orgDailyCapacity(mailboxState, now);

  const planned: BatchPlanEntry[] = [];
  const skipped: BatchSkip[] = [];

  for (const candidate of prioritize(
    input.candidates.map((c) => ({ ...c, id: c.leadId })),
  )) {
    const email = normalizeEmail(candidate.email);
    const dedupeKey = sendDedupeKey({
      leadId: candidate.leadId,
      campaignKey: input.campaignKey,
      step,
    });

    const account = candidate.accountId
      ? input.accounts.get(candidate.accountId)
      : undefined;

    const eligibility = checkSendEligibility({
      email,
      existingMessageForKey: input.existingKeys.has(dedupeKey)
        ? { id: dedupeKey }
        : null,
      suppression: input.suppressionEntries,
      registryEntry: input.registry.get(email) ?? null,
      relationship: account
        ? {
            relationship: account.relationship,
            accountName: account.name,
            siblingStages: account.leadStages
              .filter((l) => l.leadId !== candidate.leadId)
              .map((l) => l.stage),
          }
        : undefined,
      optIn: candidate.optIn,
      hasReplied: input.repliedLeadIds.has(candidate.leadId),
      now,
    });

    if (!eligibility.eligible) {
      skipped.push({
        leadId: candidate.leadId,
        email,
        reason: eligibility.reason,
        detail: eligibility.detail,
      });
      continue;
    }

    const mailbox = selectMailbox(mailboxState, now);
    if (!mailbox) {
      skipped.push({
        leadId: candidate.leadId,
        email,
        reason: 'no_capacity',
        detail: 'every mailbox is at its warmup or daily cap',
      });
      continue;
    }

    // Reserve the slot locally so rotation spreads the batch across mailboxes
    // instead of draining the healthiest one first.
    const slot = mailboxState.find((m) => m.id === mailbox.id);
    if (slot) slot.sentToday += 1;

    planned.push({
      leadId: candidate.leadId,
      email,
      mailboxId: mailbox.id,
      dedupeKey,
      step,
    });
  }

  return { campaignKey: input.campaignKey, planned, skipped, capacity };
}

/** Loads the state `planBatch` needs, scoped to the caller's org by RLS. */
export async function loadBatchInputs(
  tx: Tx,
  orgId: string,
  campaignKey: string,
  limit = 200,
): Promise<Omit<PlanInput, 'campaignKey'>> {
  const candidateRows = await tx
    .select({
      leadId: leads.id,
      contactId: leads.contactId,
      accountId: leads.accountId,
      email: contacts.email,
      score: leads.score,
      optIn: leads.optIn,
    })
    .from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .where(
      and(
        eq(leads.orgId, orgId),
        inArray(leads.stage, ['new', 'queued']),
        eq(contacts.emailVerified, true),
      ),
    )
    .limit(limit);

  const mailboxRows = await tx
    .select({
      id: mailboxes.id,
      email: mailboxes.email,
      warmupStage: mailboxes.warmupStage,
      warmupStartedAt: mailboxes.warmupStartedAt,
      dailyCap: mailboxes.dailyCap,
      health: mailboxes.health,
      status: mailboxes.status,
      isPrimary: domains.isPrimary,
    })
    .from(mailboxes)
    .leftJoin(domains, eq(domains.id, mailboxes.domainId))
    .where(and(eq(mailboxes.orgId, orgId), eq(mailboxes.status, 'active')));

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const sentTodayRows = await tx
    .select({
      mailboxId: messages.mailboxId,
      count: sql<number>`count(*)::int`,
    })
    .from(messages)
    .where(
      and(
        eq(messages.orgId, orgId),
        eq(messages.direction, 'outbound'),
        inArray(messages.status, ['sent', 'queued']),
        gte(messages.createdAt, startOfDay),
      ),
    )
    .groupBy(messages.mailboxId);

  const sentByMailbox = new Map(
    sentTodayRows.map((r) => [r.mailboxId ?? '', Number(r.count)]),
  );

  const mailboxList: Mailbox[] = mailboxRows.map((m) => ({
    id: m.id,
    email: m.email,
    warmupStage: m.warmupStage as WarmupStage,
    warmupStartedAt: m.warmupStartedAt,
    dailyCap: m.dailyCap,
    health: m.health,
    status: m.status as Mailbox['status'],
    sentToday: sentByMailbox.get(m.id) ?? 0,
    isPrimaryDomain: m.isPrimary === true,
  }));

  const suppressionRows = await tx
    .select({ value: suppression.value, reason: suppression.reason })
    .from(suppression)
    .where(eq(suppression.orgId, orgId));

  // Relationship state for the accounts in play. Two queries rather than a join
  // on the candidate rows, because the sibling-stage check needs *every* lead on
  // the account — including ones that are not batch candidates, which is exactly
  // the case that matters (a colleague already at "meeting").
  const accountIds = [
    ...new Set(
      candidateRows
        .map((c) => c.accountId)
        .filter((a): a is string => a !== null),
    ),
  ];

  const accountRows =
    accountIds.length > 0
      ? await tx
          .select({
            id: accounts.id,
            name: accounts.name,
            relationship: accounts.relationship,
          })
          .from(accounts)
          .where(
            and(eq(accounts.orgId, orgId), inArray(accounts.id, accountIds)),
          )
      : [];

  const accountLeadRows =
    accountIds.length > 0
      ? await tx
          .select({
            leadId: leads.id,
            accountId: leads.accountId,
            stage: leads.stage,
          })
          .from(leads)
          .where(and(eq(leads.orgId, orgId), inArray(leads.accountId, accountIds)))
      : [];

  const accountState = new Map<string, AccountState>(
    accountRows.map((a) => [
      a.id,
      { name: a.name, relationship: a.relationship, leadStages: [] },
    ]),
  );
  for (const row of accountLeadRows) {
    if (!row.accountId) continue;
    accountState
      .get(row.accountId)
      ?.leadStages.push({ leadId: row.leadId, stage: row.stage });
  }

  const emails = candidateRows.map((c) => normalizeEmail(c.email));
  const registryRows =
    emails.length > 0
      ? await tx
          .select({
            email: contactedRegistry.email,
            lastContactedAt: contactedRegistry.lastContactedAt,
            timesContacted: contactedRegistry.timesContacted,
          })
          .from(contactedRegistry)
          .where(
            and(
              eq(contactedRegistry.orgId, orgId),
              inArray(contactedRegistry.email, emails),
            ),
          )
      : [];

  const leadIds = candidateRows.map((c) => c.leadId);
  const repliedRows =
    leadIds.length > 0
      ? await tx
          .selectDistinct({ leadId: replies.leadId })
          .from(replies)
          .where(and(eq(replies.orgId, orgId), inArray(replies.leadId, leadIds)))
      : [];

  // Every dedupe key already used by this org. Loaded as a set so planBatch
  // stays pure and the idempotency check is a lookup rather than a query per
  // candidate.
  const keyRows = await tx
    .select({ dedupeKey: messages.dedupeKey })
    .from(messages)
    .where(and(eq(messages.orgId, orgId), isNotNull(messages.dedupeKey)));

  return {
    candidates: candidateRows.map((c) => ({
      leadId: c.leadId,
      contactId: c.contactId,
      accountId: c.accountId,
      email: c.email,
      score: c.score,
      optIn: c.optIn,
    })),
    mailboxes: mailboxList,
    suppressionEntries: suppressionRows,
    accounts: accountState,
    registry: new Map(
      registryRows.map((r) => [
        normalizeEmail(r.email),
        {
          email: normalizeEmail(r.email),
          lastContactedAt: r.lastContactedAt,
          timesContacted: r.timesContacted,
        },
      ]),
    ),
    existingKeys: new Set(
      keyRows.map((r) => r.dedupeKey).filter((k): k is string => k !== null),
    ),
    repliedLeadIds: new Set(repliedRows.map((r) => r.leadId)),
  };
}
