import { STAGE_ORDER, stageLabel } from './stages';

/**
 * Pipeline board (plataforma-completa, Conversión §12).
 *
 * A funnel owns its own ordered stages, so the board cannot reuse the global
 * `STAGE_ORDER` directly — but an org that has never configured a funnel still
 * needs a board. `funnelStages` resolves that: a configured funnel wins, and
 * the canonical order is the fallback.
 *
 * Everything here is pure. The board is a projection of leads onto columns, and
 * the transition rules are a predicate — both are things that must be exactly
 * right and are much easier to prove that way than through a route handler.
 */

export type FunnelStage = { key: string; label: string; order: number };

/**
 * Stages the engine assigns and a person must not. `queued` means "there is a
 * message for this lead in today's batch"; setting it by hand produces a lead
 * that claims to be in a batch that does not exist.
 */
export const ENGINE_OWNED_STAGES = ['queued'] as const;

export const DEFAULT_STAGES: FunnelStage[] = STAGE_ORDER.map((key, order) => ({
  key,
  label: stageLabel(key),
  order,
}));

/** Configured stages if the funnel has any, canonical order otherwise. */
export function funnelStages(
  funnel: { stages?: FunnelStage[] | null } | null | undefined,
): FunnelStage[] {
  const configured = funnel?.stages;
  if (!configured || configured.length === 0) return DEFAULT_STAGES;
  return [...configured].sort((a, b) => a.order - b.order);
}

export type BoardCard = {
  id: string;
  stage: string;
  fullName: string;
  email: string;
  company: string | null;
  score: number;
  closeProbability: number | null;
  tags: string[];
  updatedAt: Date;
};

export type BoardColumn = {
  key: string;
  label: string;
  cards: BoardCard[];
};

/**
 * Projects leads onto the funnel's columns. Cards in each column are ordered by
 * close probability and then score, so what is most worth acting on is at the
 * top of the column rather than wherever the query returned it.
 *
 * A lead whose stage is not in the funnel is not dropped — it gets a column of
 * its own at the end. Silently hiding leads from the board would make the board
 * lie about the size of the pipeline.
 */
export function buildBoard(
  stages: readonly FunnelStage[],
  cards: readonly BoardCard[],
): BoardColumn[] {
  const columns = new Map<string, BoardColumn>(
    stages.map((s) => [s.key, { key: s.key, label: s.label, cards: [] }]),
  );

  for (const card of cards) {
    let column = columns.get(card.stage);
    if (!column) {
      column = { key: card.stage, label: stageLabel(card.stage), cards: [] };
      columns.set(card.stage, column);
    }
    column.cards.push(card);
  }

  for (const column of columns.values()) {
    column.cards.sort(
      (a, b) =>
        (b.closeProbability ?? -1) - (a.closeProbability ?? -1) ||
        b.score - a.score ||
        a.fullName.localeCompare(b.fullName),
    );
  }

  return [...columns.values()];
}

/**
 * Stages that record an append-only outcome when reached.
 *
 * Analytics counts events rather than current stage, so a lead that reaches a
 * meeting and later goes cold must still show up as a meeting in the funnel.
 */
export const OUTCOME_FOR_STAGE: Record<string, string> = {
  meeting: 'meeting',
  won: 'deal',
  lost: 'lost',
};

export type TransitionResult =
  | { allowed: true }
  | { allowed: false; detail: string };

/** Validates a person-initiated stage move against the funnel's own stages. */
export function checkStageTransition(
  from: string,
  to: string,
  stages: readonly FunnelStage[],
): TransitionResult {
  if (from === to) {
    return { allowed: false, detail: `lead is already at "${to}"` };
  }
  if (!stages.some((s) => s.key === to)) {
    return { allowed: false, detail: `"${to}" is not a stage of this funnel` };
  }
  if ((ENGINE_OWNED_STAGES as readonly string[]).includes(to)) {
    return {
      allowed: false,
      detail: `"${to}" is set by the batch, not by hand`,
    };
  }
  return { allowed: true };
}
