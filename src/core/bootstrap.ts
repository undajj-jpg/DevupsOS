import { agents, funnels } from '@/db/schema';
import type { Tx } from '@/db/client';
import { audit } from '@/lib/audit';
import { DEFAULT_STAGES } from '@/core/pipeline';

/**
 * Seeds a new org with the default funnel and the agent roster from spec §6.
 *
 * Every agent lands in suggestion mode with a narrow tool allow-list. Autonomy
 * is not something an org opts into at signup — it requires passing the gate
 * in §10, which is a deliberate, audited change.
 */

/**
 * The seeded funnel is the canonical stage list, labels included. Writing the
 * labels out again here is how the board ends up showing English column heads
 * in a Spanish console — the funnel stores its own labels, so a second copy
 * drifts the moment either side is touched.
 */
export const DEFAULT_FUNNEL_STAGES = DEFAULT_STAGES;

/** The orchestrator plus the twelve specialists (§6), each tool-scoped. */
export const AGENT_ROSTER: {
  key: string;
  name: string;
  allowedTools: string[];
}[] = [
  {
    key: 'orchestrator',
    name: 'Orchestrator',
    allowedTools: [
      'get_stats',
      'get_pipeline_stats',
      'list_pending_leads',
      'list_funnels',
      'get_board',
      'get_analytics',
    ],
  },
  {
    key: 'concierge',
    name: 'Concierge (WhatsApp / voz)',
    allowedTools: ['get_stats', 'get_briefing', 'get_board', 'list_funnels'],
  },
  {
    key: 'sourcing',
    name: 'Sourcing',
    allowedTools: ['run_sourcing', 'check_contacted', 'import_leads'],
  },
  {
    key: 'copywriter',
    name: 'Copywriter',
    allowedTools: ['preview_email'],
  },
  {
    key: 'sender',
    name: 'Envío',
    allowedTools: ['create_todays_batch', 'send_batch', 'pause', 'resume'],
  },
  {
    key: 'follow_up',
    name: 'Follow-up',
    allowedTools: ['schedule_followup', 'list_pending_leads'],
  },
  {
    key: 'triage',
    name: 'Triage',
    allowedTools: [
      'list_replies',
      'classify_reply',
      'set_stage',
      'get_board',
      'move_lead',
    ],
  },
  {
    key: 'scheduler',
    name: 'Agendador',
    allowedTools: ['propose_slots', 'book_meeting', 'move_lead'],
  },
  {
    key: 'research',
    name: 'Research / 360',
    allowedTools: ['summarize_contact', 'get_contact_timeline'],
  },
  {
    key: 'librarian',
    name: 'Memoria / Bibliotecario',
    allowedTools: ['search_conversations', 'find_related', 'search_documents'],
  },
  {
    key: 'briefing',
    name: 'Briefing',
    allowedTools: ['get_briefing', 'get_pipeline_stats', 'get_analytics'],
  },
  {
    key: 'deliverability',
    name: 'Guardián de entregabilidad',
    allowedTools: ['get_stats', 'pause', 'resume', 'get_analytics'],
  },
  {
    key: 'compliance',
    // Holds a veto: it can add suppression and halt sending, and nothing
    // overrides it.
    name: 'Guardián de compliance',
    allowedTools: ['add_suppression', 'check_contacted', 'pause'],
  },
];

export async function seedOrgDefaults(
  tx: Tx,
  orgId: string,
  userId: string,
): Promise<void> {
  await tx.insert(funnels).values({
    orgId,
    name: 'Outbound',
    stages: DEFAULT_FUNNEL_STAGES,
    active: true,
  });

  await tx.insert(agents).values(
    AGENT_ROSTER.map((a) => ({
      orgId,
      key: a.key,
      name: a.name,
      allowedTools: a.allowedTools,
      mode: 'suggest' as const,
      enabled: true,
    })),
  );

  await audit(tx, {
    orgId,
    actorUserId: userId,
    actorKind: 'system',
    action: 'org.bootstrap',
    meta: { agents: AGENT_ROSTER.length, funnel: 'Outbound' },
  });
}
