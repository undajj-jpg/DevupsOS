/**
 * Canonical funnel stage order and Spanish labels.
 *
 * The dashboard groups leads with a SQL GROUP BY, which returns rows in
 * whatever order the planner chose — so a funnel rendered straight from that
 * result reads as a random list rather than a pipeline. Ordering lives here so
 * every view agrees.
 */
export const STAGE_ORDER = [
  'new',
  'queued',
  'contacted',
  'replied',
  'meeting',
  'proposal',
  'won',
  'lost',
] as const;

export const STAGE_LABEL: Record<string, string> = {
  new: 'Nuevos',
  queued: 'En cola',
  contacted: 'Contactados',
  replied: 'Respondieron',
  meeting: 'Reunión',
  proposal: 'Propuesta',
  won: 'Ganados',
  lost: 'Perdidos',
};

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

/** Stages not in the canonical list sort last, in their original order. */
export function sortByStage<T extends { stage: string }>(rows: readonly T[]): T[] {
  const rank = (s: string) => {
    const i = STAGE_ORDER.indexOf(s as (typeof STAGE_ORDER)[number]);
    return i === -1 ? STAGE_ORDER.length : i;
  };
  return [...rows].sort((a, b) => rank(a.stage) - rank(b.stage));
}

/** Won is good news, lost is not; everything in between is in progress. */
export function stageTone(stage: string): 'ok' | 'danger' | 'accent' | 'neutral' {
  if (stage === 'won') return 'ok';
  if (stage === 'lost') return 'danger';
  if (stage === 'new') return 'neutral';
  return 'accent';
}
