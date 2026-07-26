import { asc, eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { agents, orgs } from '@/db/schema';
import { authenticated, HttpError, requireRole } from '@/lib/http';
import { audit } from '@/lib/audit';
import { env } from '@/lib/env';
import { resolveAgentMode } from '@/core/autonomy';

export const runtime = 'nodejs';

export const GET = authenticated(null, async ({ session, tx }) => {
  const [org] = await tx
    .select({
      agentsEnabled: orgs.agentsEnabled,
      autonomyGatePassed: orgs.autonomyGatePassed,
    })
    .from(orgs)
    .where(eq(orgs.id, session.orgId))
    .limit(1);

  const rows = await tx
    .select({
      key: agents.key,
      name: agents.name,
      mode: agents.mode,
      enabled: agents.enabled,
      allowedTools: agents.allowedTools,
      confidenceThreshold: agents.confidenceThreshold,
      dailyActionCap: agents.dailyActionCap,
    })
    .from(agents)
    .where(eq(agents.orgId, session.orgId))
    .orderBy(asc(agents.key));

  return {
    killSwitch: {
      globalEnabled: org?.agentsEnabled ?? false,
      autonomyGatePassed: org?.autonomyGatePassed ?? false,
      forceSuggestionMode: env().FORCE_SUGGESTION_MODE,
    },
    agents: rows.map((a) => ({
      ...a,
      // The effective mode, not just what the row says — the kill switch,
      // gate and env override all fold in here.
      effective: resolveAgentMode({
        orgAgentsEnabled: org?.agentsEnabled ?? false,
        orgAutonomyGatePassed: org?.autonomyGatePassed ?? false,
        agentEnabled: a.enabled,
        agentMode: a.mode as 'suggest' | 'autonomous',
        forceSuggestionMode: env().FORCE_SUGGESTION_MODE,
      }),
    })),
  };
});

const patchSchema = z.object({
  /** Global kill switch (§3.5). */
  globalEnabled: z.boolean().optional(),
  agent: z
    .object({
      key: z.string().min(1).max(60),
      enabled: z.boolean().optional(),
      mode: z.enum(['suggest', 'autonomous']).optional(),
      confidenceThreshold: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export const PATCH = authenticated(patchSchema, async ({ body, session, tx }) => {
  requireRole(session, ['owner', 'admin']);

  if (body.globalEnabled !== undefined) {
    await tx
      .update(orgs)
      .set({ agentsEnabled: body.globalEnabled })
      .where(eq(orgs.id, session.orgId));

    await audit(tx, {
      orgId: session.orgId,
      actorUserId: session.userId,
      action: body.globalEnabled ? 'killswitch.released' : 'killswitch.engaged',
    });
  }

  if (body.agent) {
    const [org] = await tx
      .select({ autonomyGatePassed: orgs.autonomyGatePassed })
      .from(orgs)
      .where(eq(orgs.id, session.orgId))
      .limit(1);

    // Autonomy cannot be switched on before the gate passes (§10). This is a
    // hard refusal rather than a silent downgrade so the operator learns why.
    if (body.agent.mode === 'autonomous' && !org?.autonomyGatePassed) {
      throw new HttpError(
        409,
        'autonomy gate has not been passed; agents remain in suggestion mode',
        'autonomy_gate_closed',
      );
    }

    const patch: Record<string, unknown> = {};
    if (body.agent.enabled !== undefined) patch.enabled = body.agent.enabled;
    if (body.agent.mode !== undefined) patch.mode = body.agent.mode;
    if (body.agent.confidenceThreshold !== undefined) {
      patch.confidenceThreshold = body.agent.confidenceThreshold;
    }

    if (Object.keys(patch).length > 0) {
      await tx
        .update(agents)
        .set(patch)
        .where(
          and(eq(agents.orgId, session.orgId), eq(agents.key, body.agent.key)),
        );

      await audit(tx, {
        orgId: session.orgId,
        actorUserId: session.userId,
        action: 'agent.updated',
        meta: { key: body.agent.key, ...patch },
      });
    }
  }

  return { updated: true };
});
