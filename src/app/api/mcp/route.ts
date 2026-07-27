import { and, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  agents,
  contacts,
  funnels,
  leads,
  mailboxes,
  messages,
  orgs,
  outcomes,
  replies,
  suppression,
} from '@/db/schema';
import { withOrgContext, db, type Tx } from '@/db/client';
import {
  bearerToken,
  clientIp,
  handleError,
  HttpError,
  jsonError,
  secretEquals,
} from '@/lib/http';
import { LIMITS, rateLimit } from '@/lib/rate-limit';
import { env } from '@/lib/env';
import { prepareTodaysBatch } from '@/core/sendPipeline';
import { domainSuppressionKey, suppressionKey } from '@/core/suppression';
import { normalizeEmail } from '@/core/email';
import { checkAntiResend } from '@/core/dedupe';
import { contactedRegistry } from '@/db/schema';
import { resolveAgentMode, requiresHumanApproval } from '@/core/autonomy';
import {
  checkStageTransition,
  funnelStages,
  OUTCOME_FOR_STAGE,
} from '@/core/pipeline';
import { analyticsFor, boardFor } from '@/lib/reporting';
import { trace } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * MCP tool surface (spec §7).
 *
 * Three things are true of every call here, and none of them are optional:
 *
 *   - Auth is a real bearer token in the Authorization header, never a query
 *     parameter (§3.3). Comparison is constant-time.
 *   - Every tool declares which agent may invoke it, and the invoking agent's
 *     allow-list is checked against the DB before the tool runs (§3.2).
 *   - Tools that take irreversible action are refused outright while the agent
 *     is in suggestion mode (§10) — they return a proposal, not a side effect.
 */

type ToolContext = {
  tx: Tx;
  orgId: string;
  userId: string;
  agentKey: string;
  mode: 'suggest' | 'autonomous';
};

type Tool = {
  description: string;
  /** Which agent keys may call this tool. */
  agents: string[];
  /** Refused in suggestion mode; returns a proposal instead. */
  irreversible?: boolean;
  input: z.ZodType<never, z.ZodTypeDef, unknown> | z.ZodTypeAny;
  run: (ctx: ToolContext, input: never) => Promise<unknown>;
};

const tools: Record<string, Tool> = {
  get_stats: {
    description: 'Counts of leads, drafts awaiting approval, and replies.',
    agents: ['orchestrator', 'concierge', 'deliverability', 'briefing'],
    input: z.object({}).strict(),
    run: async ({ tx, orgId }) => {
      const [leadCount] = await tx
        .select({ n: count() })
        .from(leads)
        .where(eq(leads.orgId, orgId));
      const [pending] = await tx
        .select({ n: count() })
        .from(messages)
        .where(
          and(eq(messages.orgId, orgId), eq(messages.status, 'pending_approval')),
        );
      const [replyCount] = await tx
        .select({ n: count() })
        .from(replies)
        .where(eq(replies.orgId, orgId));
      const [suppressed] = await tx
        .select({ n: count() })
        .from(suppression)
        .where(eq(suppression.orgId, orgId));

      return {
        leads: leadCount?.n ?? 0,
        pendingApproval: pending?.n ?? 0,
        replies: replyCount?.n ?? 0,
        suppressed: suppressed?.n ?? 0,
      };
    },
  },

  get_pipeline_stats: {
    description: 'Lead counts grouped by funnel stage.',
    agents: ['orchestrator', 'briefing', 'concierge'],
    input: z.object({}).strict(),
    run: async ({ tx, orgId }) => {
      const rows = await tx
        .select({ stage: leads.stage, n: count() })
        .from(leads)
        .where(eq(leads.orgId, orgId))
        .groupBy(leads.stage);
      return { byStage: rows };
    },
  },

  list_pending_leads: {
    description: 'Highest-scoring leads not yet contacted.',
    agents: ['orchestrator', 'sourcing', 'follow_up'],
    input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
    run: async ({ tx, orgId }, input: { limit: number }) => {
      const rows = await tx
        .select({
          leadId: leads.id,
          email: contacts.email,
          name: contacts.fullName,
          score: leads.score,
          stage: leads.stage,
        })
        .from(leads)
        .innerJoin(contacts, eq(contacts.id, leads.contactId))
        .where(and(eq(leads.orgId, orgId), eq(leads.stage, 'new')))
        .orderBy(desc(leads.score))
        .limit(input.limit);
      return { leads: rows };
    },
  },

  check_contacted: {
    description:
      'Whether an address is already in the anti-resend registry, and whether a new touch would be permitted.',
    agents: ['sourcing', 'compliance'],
    input: z.object({ email: z.string().max(254) }),
    run: async ({ tx, orgId }, input: { email: string }) => {
      const email = normalizeEmail(input.email);
      const [row] = await tx
        .select({
          email: contactedRegistry.email,
          lastContactedAt: contactedRegistry.lastContactedAt,
          timesContacted: contactedRegistry.timesContacted,
        })
        .from(contactedRegistry)
        .where(
          and(
            eq(contactedRegistry.orgId, orgId),
            eq(contactedRegistry.email, email),
          ),
        )
        .limit(1);

      const verdict = checkAntiResend(email, row ?? null);
      return {
        email,
        contacted: Boolean(row),
        timesContacted: row?.timesContacted ?? 0,
        lastContactedAt: row?.lastContactedAt ?? null,
        allowed: verdict.allowed,
        reason: verdict.allowed ? null : verdict.detail,
      };
    },
  },

  preview_email: {
    description: 'The drafted subject and body for a pending message.',
    agents: ['copywriter', 'orchestrator'],
    input: z.object({ messageId: z.string().uuid() }),
    run: async ({ tx, orgId }, input: { messageId: string }) => {
      const [row] = await tx
        .select({
          id: messages.id,
          subject: messages.subject,
          body: messages.body,
          status: messages.status,
          variantKey: messages.variantKey,
        })
        .from(messages)
        .where(
          and(eq(messages.orgId, orgId), eq(messages.id, input.messageId)),
        )
        .limit(1);
      if (!row) throw new HttpError(404, 'message not found', 'not_found');
      return row;
    },
  },

  list_replies: {
    description: 'Recent inbound replies with their classification.',
    agents: ['triage', 'orchestrator', 'briefing'],
    input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
    run: async ({ tx, orgId }, input: { limit: number }) => {
      const rows = await tx
        .select({
          id: replies.id,
          leadId: replies.leadId,
          category: replies.category,
          sentiment: replies.sentiment,
          closeProbability: replies.closeProbability,
          createdAt: replies.createdAt,
        })
        .from(replies)
        .where(eq(replies.orgId, orgId))
        .orderBy(desc(replies.createdAt))
        .limit(input.limit);
      return { replies: rows };
    },
  },

  create_todays_batch: {
    description:
      'Prepares drafts for the day. Produces pending_approval messages; sends nothing.',
    agents: ['sender', 'orchestrator'],
    // Consumes mailbox capacity and writes drafts, so it is gated even though
    // it does not deliver mail.
    irreversible: true,
    input: z.object({
      campaignKey: z.string().min(1).max(60).regex(/^[a-z0-9_-]+$/),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    run: async (
      { tx, orgId, userId },
      input: { campaignKey: string; limit?: number },
    ) =>
      prepareTodaysBatch(tx, {
        orgId,
        userId,
        campaignKey: input.campaignKey,
        limit: input.limit,
      }),
  },

  add_suppression: {
    description: 'Adds an address or domain to the blocking suppression list.',
    agents: ['compliance'],
    irreversible: true,
    input: z.object({
      value: z.string().min(3).max(254),
      scope: z.enum(['address', 'domain']).default('address'),
      reason: z.enum([
        'unsubscribe',
        'customer',
        'open_deal',
        'bounce',
        'manual',
        'complaint',
      ]),
    }),
    run: async (
      { tx, orgId },
      input: { value: string; scope: 'address' | 'domain'; reason: string },
    ) => {
      const key =
        input.scope === 'domain'
          ? domainSuppressionKey(input.value)
          : suppressionKey(input.value);
      await tx
        .insert(suppression)
        .values({ orgId, value: key, reason: input.reason })
        .onConflictDoNothing({ target: [suppression.orgId, suppression.value] });
      return { suppressed: key };
    },
  },

  pause: {
    description: 'Engages the global kill switch; all agents stop acting.',
    agents: ['deliverability', 'compliance', 'sender', 'orchestrator'],
    input: z.object({ reason: z.string().max(300).optional() }),
    run: async ({ tx, orgId }, input: { reason?: string }) => {
      await tx
        .update(orgs)
        .set({ agentsEnabled: false })
        .where(eq(orgs.id, orgId));
      return { paused: true, reason: input.reason ?? null };
    },
  },

  resume: {
    description: 'Releases the global kill switch.',
    agents: ['orchestrator'],
    // Restoring agent action is a human decision, not an agent one.
    irreversible: true,
    input: z.object({}).strict(),
    run: async ({ tx, orgId }) => {
      await tx.update(orgs).set({ agentsEnabled: true }).where(eq(orgs.id, orgId));
      return { paused: false };
    },
  },

  get_briefing: {
    description: 'Daily briefing: capacity, drafts awaiting review, new replies.',
    agents: ['briefing', 'concierge', 'orchestrator'],
    input: z.object({}).strict(),
    run: async ({ tx, orgId }) => {
      const mailboxRows = await tx
        .select({
          email: mailboxes.email,
          warmupStage: mailboxes.warmupStage,
          dailyCap: mailboxes.dailyCap,
          health: mailboxes.health,
          status: mailboxes.status,
        })
        .from(mailboxes)
        .where(eq(mailboxes.orgId, orgId));

      const [pending] = await tx
        .select({ n: count() })
        .from(messages)
        .where(
          and(eq(messages.orgId, orgId), eq(messages.status, 'pending_approval')),
        );

      const unhandled = await tx
        .select({ n: count() })
        .from(replies)
        .where(and(eq(replies.orgId, orgId), eq(replies.handled, false)));

      return {
        mailboxes: mailboxRows,
        draftsAwaitingApproval: pending?.n ?? 0,
        unhandledReplies: unhandled[0]?.n ?? 0,
      };
    },
  },

  list_funnels: {
    description: 'Configured funnels and their ordered stages.',
    agents: ['orchestrator', 'triage', 'briefing', 'concierge'],
    input: z.object({}).strict(),
    run: async ({ tx, orgId }) => {
      const board = await boardFor(tx, orgId);
      return { funnels: board.funnels, stages: board.stages };
    },
  },

  get_board: {
    description: 'Kanban board for a funnel: leads grouped into stage columns.',
    agents: ['orchestrator', 'triage', 'briefing', 'concierge'],
    input: z.object({ funnelId: z.string().uuid().optional() }),
    run: async ({ tx, orgId }, input: { funnelId?: string }) => {
      const board = await boardFor(tx, orgId, input.funnelId);
      return {
        funnel: board.selected,
        total: board.total,
        columns: board.columns.map((c) => ({
          stage: c.key,
          label: c.label,
          count: c.cards.length,
          leads: c.cards.map((card) => ({
            leadId: card.id,
            name: card.fullName,
            company: card.company,
            score: card.score,
            closeProbability: card.closeProbability,
            tags: card.tags,
          })),
        })),
      };
    },
  },

  move_lead: {
    description: "Moves a lead to another stage of its funnel.",
    agents: ['triage', 'scheduler', 'orchestrator'],
    // Reversible on paper, but reaching `meeting`, `won` or `lost` writes an
    // append-only outcome row that the conversion report counts — an agent that
    // could move leads at will could also move the numbers.
    irreversible: true,
    input: z.object({
      leadId: z.string().uuid(),
      stage: z.string().min(1).max(64),
    }),
    run: async ({ tx, orgId }, input: { leadId: string; stage: string }) => {
      const [lead] = await tx
        .select({ stage: leads.stage, funnelId: leads.funnelId })
        .from(leads)
        .where(and(eq(leads.orgId, orgId), eq(leads.id, input.leadId)))
        .limit(1);
      if (!lead) throw new HttpError(404, 'lead not found', 'not_found');

      const [funnel] = lead.funnelId
        ? await tx
            .select({ stages: funnels.stages })
            .from(funnels)
            .where(and(eq(funnels.orgId, orgId), eq(funnels.id, lead.funnelId)))
            .limit(1)
        : [];

      const transition = checkStageTransition(
        lead.stage,
        input.stage,
        funnelStages(funnel ?? null),
      );
      if (!transition.allowed) {
        throw new HttpError(422, transition.detail, 'invalid_transition');
      }

      await tx
        .update(leads)
        .set({ stage: input.stage, updatedAt: new Date() })
        .where(and(eq(leads.orgId, orgId), eq(leads.id, input.leadId)));

      const kind = OUTCOME_FOR_STAGE[input.stage];
      if (kind) {
        await tx
          .insert(outcomes)
          .values({ orgId, leadId: input.leadId, kind });
      }

      return { leadId: input.leadId, from: lead.stage, to: input.stage };
    },
  },

  get_analytics: {
    description:
      'Conversion funnel from sent to closed, model spend, and A/B results.',
    agents: ['orchestrator', 'briefing', 'concierge', 'deliverability'],
    input: z.object({}).strict(),
    run: async ({ tx, orgId }) => analyticsFor(tx, orgId),
  },
};

const requestSchema = z.object({
  tool: z.string().min(1).max(80),
  /** Which agent is invoking. Checked against that agent's allow-list. */
  agent: z.string().min(1).max(60),
  input: z.unknown().optional(),
});

export async function POST(req: Request) {
  try {
    const configured = env().MCP_TOKEN;
    if (!configured) {
      return jsonError(503, 'MCP surface is not configured', 'not_configured');
    }

    const token = bearerToken(req);
    if (!token || !secretEquals(token, configured)) {
      return jsonError(401, 'invalid MCP credentials', 'unauthorized');
    }

    const limited = await rateLimit('mcp', token, LIMITS.mcp);
    if (!limited.allowed) {
      return jsonError(429, 'rate limit exceeded', 'rate_limited');
    }

    const parsed = requestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(400, 'tool and agent are required', 'validation_failed');
    }

    const tool = tools[parsed.data.tool];
    if (!tool) {
      return jsonError(404, `unknown tool "${parsed.data.tool}"`, 'unknown_tool');
    }

    // The token authenticates the caller but says nothing about which org it
    // acts for, so the org is resolved from the DB rather than trusted input.
    const targets = await db().execute<{ org_id: string; owner_id: string }>(
      sql`SELECT * FROM app.list_schedulable_orgs() LIMIT 1`,
    );
    const target = targets[0];
    if (!target) {
      return jsonError(404, 'no active organization', 'not_found');
    }

    return await withOrgContext(
      { orgId: target.org_id, userId: target.owner_id, role: 'service' },
      async (tx) => {
        const [agent] = await tx
          .select({
            key: agents.key,
            mode: agents.mode,
            enabled: agents.enabled,
            allowedTools: agents.allowedTools,
          })
          .from(agents)
          .where(
            and(eq(agents.orgId, target.org_id), eq(agents.key, parsed.data.agent)),
          )
          .limit(1);

        if (!agent) {
          return jsonError(404, `unknown agent "${parsed.data.agent}"`, 'not_found');
        }

        // Two independent allow-lists must both pass: the tool declares which
        // agents may reach it, and the agent row declares which tools it may
        // call. Neither alone is authoritative.
        if (!tool.agents.includes(agent.key)) {
          return jsonError(403, 'tool is not exposed to this agent', 'forbidden');
        }
        if (!agent.allowedTools.includes(parsed.data.tool)) {
          return jsonError(403, 'tool is not in the agent allow-list', 'forbidden');
        }

        const [org] = await tx
          .select({
            agentsEnabled: orgs.agentsEnabled,
            autonomyGatePassed: orgs.autonomyGatePassed,
          })
          .from(orgs)
          .where(eq(orgs.id, target.org_id))
          .limit(1);

        const decision = resolveAgentMode({
          orgAgentsEnabled: org?.agentsEnabled ?? false,
          orgAutonomyGatePassed: org?.autonomyGatePassed ?? false,
          agentEnabled: agent.enabled,
          agentMode: agent.mode as 'suggest' | 'autonomous',
          forceSuggestionMode: env().FORCE_SUGGESTION_MODE,
        });

        // `pause` is exempt: stopping the machine must work even when the
        // machine is stopped.
        if (!decision.allowed && parsed.data.tool !== 'pause') {
          await trace(tx, {
            orgId: target.org_id,
            agentKey: agent.key,
            tool: parsed.data.tool,
            outcome: 'blocked',
            blockedReason: decision.reason,
          });
          return jsonError(409, decision.reason, 'agent_disabled');
        }

        const mode = decision.allowed ? decision.mode : 'suggest';

        if (tool.irreversible && requiresHumanApproval(parsed.data.tool, mode)) {
          await trace(tx, {
            orgId: target.org_id,
            agentKey: agent.key,
            tool: parsed.data.tool,
            outcome: 'proposed',
            input: (parsed.data.input as Record<string, unknown>) ?? {},
            blockedReason: 'requires human approval',
          });
          return Response.json(
            {
              data: {
                status: 'proposal',
                tool: parsed.data.tool,
                message:
                  'This action is irreversible and the agent is in suggestion mode. A human must approve it in the console.',
                proposedInput: parsed.data.input ?? {},
              },
            },
            { status: 202 },
          );
        }

        const inputParsed = tool.input.safeParse(parsed.data.input ?? {});
        if (!inputParsed.success) {
          return jsonError(
            400,
            inputParsed.error.issues
              .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
              .join('; '),
            'validation_failed',
          );
        }

        const output = await tool.run(
          {
            tx,
            orgId: target.org_id,
            userId: target.owner_id,
            agentKey: agent.key,
            mode,
          },
          inputParsed.data as never,
        );

        await trace(tx, {
          orgId: target.org_id,
          agentKey: agent.key,
          tool: parsed.data.tool,
          outcome: 'executed',
          input: (parsed.data.input as Record<string, unknown>) ?? {},
        });

        return Response.json({ data: output });
      },
    );
  } catch (err) {
    return handleError(err);
  }
}

/** Tool catalogue, for discovery. Requires the same bearer token. */
export async function GET(req: Request) {
  const configured = env().MCP_TOKEN;
  if (!configured) {
    return jsonError(503, 'MCP surface is not configured', 'not_configured');
  }
  const token = bearerToken(req);
  if (!token || !secretEquals(token, configured)) {
    return jsonError(401, 'invalid MCP credentials', 'unauthorized');
  }
  await rateLimit('mcp', clientIp(req), LIMITS.mcp);

  return Response.json({
    data: {
      tools: Object.entries(tools).map(([name, t]) => ({
        name,
        description: t.description,
        agents: t.agents,
        requiresApproval: Boolean(t.irreversible),
      })),
    },
  });
}
