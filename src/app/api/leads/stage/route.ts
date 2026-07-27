import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authenticated, HttpError } from '@/lib/http';
import { funnels, leads, outcomes } from '@/db/schema';
import {
  checkStageTransition,
  funnelStages,
  OUTCOME_FOR_STAGE,
} from '@/core/pipeline';
import { audit } from '@/lib/audit';

export const runtime = 'nodejs';

const schema = z.object({
  leadId: z.string().uuid(),
  stage: z.string().min(1).max(64),
});

/**
 * Moves a lead between pipeline stages (plataforma-completa §12).
 *
 * Every move is audited, because the board is the one place where a person can
 * change what the funnel reports, and an unexplained jump to `won` is exactly
 * the thing someone will want to trace back later.
 *
 * Reaching `meeting`, `won` or `lost` also writes an `outcomes` row, so the
 * conversion report keeps counting a meeting that later went cold.
 */
export const POST = authenticated(schema, async ({ body, session, tx }) => {
  const [lead] = await tx
    .select({
      id: leads.id,
      stage: leads.stage,
      funnelId: leads.funnelId,
    })
    .from(leads)
    .where(and(eq(leads.orgId, session.orgId), eq(leads.id, body.leadId)))
    .limit(1);

  // RLS already scoped the query, so a miss means "not yours or not there" —
  // the same 404 either way, on purpose.
  if (!lead) throw new HttpError(404, 'lead not found', 'not_found');

  const [funnel] = lead.funnelId
    ? await tx
        .select({ stages: funnels.stages })
        .from(funnels)
        .where(
          and(eq(funnels.orgId, session.orgId), eq(funnels.id, lead.funnelId)),
        )
        .limit(1)
    : [];

  const transition = checkStageTransition(
    lead.stage,
    body.stage,
    funnelStages(funnel ?? null),
  );
  if (!transition.allowed) {
    throw new HttpError(422, transition.detail, 'invalid_transition');
  }

  await tx
    .update(leads)
    .set({ stage: body.stage, updatedAt: new Date() })
    .where(and(eq(leads.orgId, session.orgId), eq(leads.id, body.leadId)));

  const outcomeKind = OUTCOME_FOR_STAGE[body.stage];
  if (outcomeKind) {
    await tx.insert(outcomes).values({
      orgId: session.orgId,
      leadId: body.leadId,
      kind: outcomeKind,
    });
  }

  await audit(tx, {
    orgId: session.orgId,
    actorUserId: session.userId,
    action: 'lead.stage_changed',
    resourceTable: 'leads',
    resourceId: body.leadId,
    meta: { from: lead.stage, to: body.stage },
  });

  return { leadId: body.leadId, from: lead.stage, to: body.stage };
});
