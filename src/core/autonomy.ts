/**
 * The autonomy gate (spec §10) and kill switches (§3.5).
 *
 * This is deliberately a pure function over an explicit checklist: whether an
 * agent may act on its own is a property of the deployment, not a runtime
 * judgement call. Until every item is true, every agent runs in suggestion
 * mode — it proposes, a human confirms.
 */

export type AutonomyChecklist = {
  /** Secrets live in a manager and OAuth tokens are encrypted at rest. */
  secretsManaged: boolean;
  /** External content is fenced as data, never instruction. */
  promptInjectionDefense: boolean;
  /** Real auth on every surface + RLS active in Postgres. */
  authAndRls: boolean;
  /** Irreversible actions require a human in the loop. */
  humanInTheLoop: boolean;
  /** Global and per-agent kill switches exist and are reachable. */
  killSwitch: boolean;
  /** Infrastructure scheduler + idempotent job execution. */
  schedulerAndIdempotency: boolean;
  /** Suppression blocks sends before they leave the building. */
  blockingSuppression: boolean;
};

export const AUTONOMY_REQUIREMENTS: (keyof AutonomyChecklist)[] = [
  'secretsManaged',
  'promptInjectionDefense',
  'authAndRls',
  'humanInTheLoop',
  'killSwitch',
  'schedulerAndIdempotency',
  'blockingSuppression',
];

export type GateResult = {
  passed: boolean;
  missing: (keyof AutonomyChecklist)[];
};

export function evaluateAutonomyGate(
  checklist: AutonomyChecklist,
): GateResult {
  const missing = AUTONOMY_REQUIREMENTS.filter((k) => !checklist[k]);
  return { passed: missing.length === 0, missing };
}

export type AgentMode = 'suggest' | 'autonomous';

export type AgentRuntime = {
  orgAgentsEnabled: boolean;
  orgAutonomyGatePassed: boolean;
  agentEnabled: boolean;
  agentMode: AgentMode;
  /** Env-level override; when true, autonomy is refused unconditionally. */
  forceSuggestionMode: boolean;
};

export type AgentDecision =
  | { allowed: false; reason: string }
  | { allowed: true; mode: AgentMode };

/**
 * Resolves what an agent is permitted to do right now. Autonomy has to be
 * granted by every layer; any single "no" — global switch, per-agent switch,
 * unpassed gate, env override — collapses to suggestion mode or a hard stop.
 */
export function resolveAgentMode(runtime: AgentRuntime): AgentDecision {
  if (!runtime.orgAgentsEnabled) {
    return { allowed: false, reason: 'global kill switch is engaged' };
  }
  if (!runtime.agentEnabled) {
    return { allowed: false, reason: 'agent kill switch is engaged' };
  }
  if (runtime.agentMode === 'suggest') {
    return { allowed: true, mode: 'suggest' };
  }
  if (runtime.forceSuggestionMode) {
    return { allowed: true, mode: 'suggest' };
  }
  if (!runtime.orgAutonomyGatePassed) {
    return { allowed: true, mode: 'suggest' };
  }
  return { allowed: true, mode: 'autonomous' };
}

/** Actions that can never be triggered by a model without human sign-off. */
export const IRREVERSIBLE_ACTIONS = new Set([
  'send_batch',
  'send_message',
  'book_meeting',
  'add_suppression',
  'import_leads',
  // Reversible on paper, but reaching meeting/won/lost writes an append-only
  // outcome row that the conversion report counts.
  'move_lead',
  'delete_lead',
  'run_dsr_delete',
]);

export function requiresHumanApproval(
  action: string,
  mode: AgentMode,
): boolean {
  if (mode === 'suggest') return true;
  return IRREVERSIBLE_ACTIONS.has(action);
}
