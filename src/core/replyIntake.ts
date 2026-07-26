import { and, eq } from 'drizzle-orm';
import { contacts, followUps, leads, messages, replies, suppression } from '@/db/schema';
import type { Tx } from '@/db/client';
import { classifyReply, requiresSuppression, shouldStopCadence } from './triage';
import { audit, trace } from '@/lib/audit';

/**
 * Ingests an inbound reply and routes it (spec §5, Fase 1).
 *
 * Order is deliberate: the reply is persisted first, then classified, then
 * acted on. Suppression is applied before anything else in the act phase, so
 * an opt-out takes effect even if a later step fails.
 */
export async function ingestReply(
  tx: Tx,
  args: {
    orgId: string;
    leadId: string;
    messageId?: string | null;
    body: string;
  },
): Promise<{
  replyId: string;
  category: string;
  suppressed: boolean;
  cadenceStopped: boolean;
}> {
  const classification = await classifyReply(args.body);

  const [reply] = await tx
    .insert(replies)
    .values({
      orgId: args.orgId,
      leadId: args.leadId,
      messageId: args.messageId ?? null,
      rawBody: args.body,
      category: classification.category,
      sentiment: classification.sentiment,
      closeProbability: classification.closeProbability,
      handled: false,
    })
    .returning({ id: replies.id });

  if (!reply) throw new Error('failed to record reply');

  await trace(tx, {
    orgId: args.orgId,
    agentKey: 'triage',
    tool: 'classify_reply',
    outcome: 'proposed',
    confidence: classification.confidence,
    output: {
      category: classification.category,
      sentiment: classification.sentiment,
      reasoning: classification.reasoning,
    },
  });

  let suppressed = false;
  if (requiresSuppression(classification)) {
    const [contact] = await tx
      .select({ email: contacts.email })
      .from(leads)
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .where(and(eq(leads.orgId, args.orgId), eq(leads.id, args.leadId)))
      .limit(1);

    if (contact) {
      await tx
        .insert(suppression)
        .values({
          orgId: args.orgId,
          value: contact.email,
          reason: 'unsubscribe',
          note: 'auto-added from inbound reply',
        })
        .onConflictDoNothing({ target: [suppression.orgId, suppression.value] });
      suppressed = true;
    }
  }

  const cadenceStopped = shouldStopCadence(classification.category);
  if (cadenceStopped) {
    await tx
      .update(followUps)
      .set({ status: 'cancelled', cancelledReason: classification.category })
      .where(
        and(
          eq(followUps.orgId, args.orgId),
          eq(followUps.leadId, args.leadId),
          eq(followUps.status, 'pending'),
        ),
      );

    await tx
      .update(leads)
      .set({
        stage: classification.category === 'interested' ? 'replied' : 'lost',
        closeProbability: classification.closeProbability,
        updatedAt: new Date(),
      })
      .where(and(eq(leads.orgId, args.orgId), eq(leads.id, args.leadId)));
  }

  // Any outbound draft still awaiting approval is now stale.
  await tx
    .update(messages)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(messages.orgId, args.orgId),
        eq(messages.leadId, args.leadId),
        eq(messages.status, 'pending_approval'),
      ),
    );

  await audit(tx, {
    orgId: args.orgId,
    actorKind: 'system',
    action: 'reply.ingested',
    resourceTable: 'replies',
    resourceId: reply.id,
    meta: { category: classification.category, suppressed, cadenceStopped },
  });

  return {
    replyId: reply.id,
    category: classification.category,
    suppressed,
    cadenceStopped,
  };
}
