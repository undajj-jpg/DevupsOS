import { and, count, countDistinct, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  accounts,
  agentTraces,
  contacts,
  experimentAssignments,
  funnels,
  leadTags,
  leads,
  messages,
  outcomes,
  replies,
} from '@/db/schema';
import type { Tx } from '@/db/client';
import { buildBoard, funnelStages, type BoardCard } from '@/core/pipeline';
import {
  compareVariants,
  conversionFunnel,
  costPer,
  type VariantInput,
} from '@/core/analytics';
import { POSITIVE_REPLY_CATEGORIES } from '@/core/triage';

/**
 * Read models shared by the console and the MCP surface.
 *
 * Both need the same board and the same funnel, and the moment those are two
 * implementations they start disagreeing — an operator and an agent would be
 * looking at different numbers for the same org. So the queries live here and
 * take a transaction; the caller supplies RLS context.
 */

/** Kanban board for one funnel (plataforma-completa §12). */
export async function boardFor(tx: Tx, orgId: string, funnelId?: string) {
  const funnelRows = await tx
    .select({
      id: funnels.id,
      name: funnels.name,
      stages: funnels.stages,
      active: funnels.active,
    })
    .from(funnels)
    .where(eq(funnels.orgId, orgId))
    .orderBy(funnels.name);

  // Resolved rather than trusted: an org with no funnels still gets a board on
  // the canonical stages, and an unknown id falls back instead of rendering
  // an empty page.
  const selected =
    funnelRows.find((f) => f.id === funnelId) ??
    funnelRows.find((f) => f.active) ??
    funnelRows[0] ??
    null;

  const stages = funnelStages(selected);

  const leadRows = await tx
    .select({
      id: leads.id,
      stage: leads.stage,
      score: leads.score,
      closeProbability: leads.closeProbability,
      updatedAt: leads.updatedAt,
      funnelId: leads.funnelId,
      fullName: contacts.fullName,
      email: contacts.email,
      company: accounts.name,
    })
    .from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .leftJoin(accounts, eq(accounts.id, leads.accountId))
    .where(eq(leads.orgId, orgId))
    .orderBy(desc(leads.updatedAt))
    .limit(500);

  // Leads with no funnel belong to the default board rather than to nowhere;
  // otherwise every lead the importer created would be invisible here.
  const scoped = selected
    ? leadRows.filter((l) => l.funnelId === selected.id || l.funnelId === null)
    : leadRows;

  const tagRows =
    scoped.length > 0
      ? await tx
          .select({ leadId: leadTags.leadId, tag: leadTags.tag })
          .from(leadTags)
          .where(
            and(
              eq(leadTags.orgId, orgId),
              inArray(
                leadTags.leadId,
                scoped.map((l) => l.id),
              ),
            ),
          )
      : [];

  const tagsByLead = new Map<string, string[]>();
  for (const row of tagRows) {
    const list = tagsByLead.get(row.leadId) ?? [];
    list.push(row.tag);
    tagsByLead.set(row.leadId, list);
  }

  const cards: BoardCard[] = scoped.map((l) => ({
    id: l.id,
    stage: l.stage,
    fullName: l.fullName,
    email: l.email,
    company: l.company,
    score: l.score,
    closeProbability: l.closeProbability,
    tags: tagsByLead.get(l.id) ?? [],
    updatedAt: l.updatedAt,
  }));

  return {
    funnels: funnelRows.map((f) => ({ id: f.id, name: f.name, active: f.active })),
    selected: selected ? { id: selected.id, name: selected.name } : null,
    stages,
    columns: buildBoard(stages, cards),
    total: cards.length,
  };
}

/**
 * Conversion economics (master spec §8; plataforma-completa §25).
 *
 * Counts come from append-only tables — messages, replies, outcomes — because a
 * funnel derived from `leads.stage` forgets every step a lead passed through: a
 * lead that replied and then went cold reads as `lost` and would silently
 * disappear from the reply rate.
 */
export async function analyticsFor(tx: Tx, orgId: string) {
  const [sent] = await tx
    .select({ n: count() })
    .from(messages)
    .where(
      and(
        eq(messages.orgId, orgId),
        eq(messages.direction, 'outbound'),
        inArray(messages.status, ['sent', 'queued']),
      ),
    );

  const [replied] = await tx
    .select({ n: countDistinct(replies.leadId) })
    .from(replies)
    .where(eq(replies.orgId, orgId));

  const [positive] = await tx
    .select({ n: countDistinct(replies.leadId) })
    .from(replies)
    .where(
      and(
        eq(replies.orgId, orgId),
        inArray(replies.category, [...POSITIVE_REPLY_CATEGORIES]),
      ),
    );

  const outcomeRows = await tx
    .select({ kind: outcomes.kind, n: count() })
    .from(outcomes)
    .where(eq(outcomes.orgId, orgId))
    .groupBy(outcomes.kind);

  const byKind = new Map(outcomeRows.map((r) => [r.kind, r.n]));

  const [spend] = await tx
    .select({ usd: sql<number>`coalesce(sum(${agentTraces.costUsd}), 0)::float8` })
    .from(agentTraces)
    .where(eq(agentTraces.orgId, orgId));

  const funnelInput = {
    sent: sent?.n ?? 0,
    replied: replied?.n ?? 0,
    positive: positive?.n ?? 0,
    meetings: byKind.get('meeting') ?? 0,
    deals: byKind.get('deal') ?? 0,
  };

  // A/B: assignments give the denominator, replies and meeting outcomes the
  // numerators. Counted with DISTINCT over a join rather than as separate
  // queries, so a lead with two replies still counts once.
  const variantRows = await tx
    .select({
      experimentKey: experimentAssignments.experimentKey,
      variant: experimentAssignments.variant,
      assigned: countDistinct(experimentAssignments.leadId),
      replied: countDistinct(replies.leadId),
      meetings: countDistinct(outcomes.id),
    })
    .from(experimentAssignments)
    .leftJoin(
      replies,
      and(
        eq(replies.orgId, experimentAssignments.orgId),
        eq(replies.leadId, experimentAssignments.leadId),
      ),
    )
    .leftJoin(
      outcomes,
      and(
        eq(outcomes.orgId, experimentAssignments.orgId),
        eq(outcomes.leadId, experimentAssignments.leadId),
        eq(outcomes.kind, 'meeting'),
      ),
    )
    .where(eq(experimentAssignments.orgId, orgId))
    .groupBy(experimentAssignments.experimentKey, experimentAssignments.variant);

  const experiments = new Map<string, VariantInput[]>();
  for (const row of variantRows) {
    const list = experiments.get(row.experimentKey) ?? [];
    list.push({
      variant: row.variant,
      assigned: row.assigned,
      replied: row.replied,
      meetings: row.meetings,
    });
    experiments.set(row.experimentKey, list);
  }

  const modelCostUsd = Number(spend?.usd ?? 0);

  return {
    funnel: conversionFunnel(funnelInput),
    totals: funnelInput,
    modelCostUsd,
    costPerMeeting: costPer(modelCostUsd, funnelInput.meetings),
    costPerDeal: costPer(modelCostUsd, funnelInput.deals),
    experiments: [...experiments.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rows]) => ({ key, variants: compareVariants(rows) })),
  };
}
