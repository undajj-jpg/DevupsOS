/**
 * Conversion economics (plataforma-completa, Gobierno §25; master spec §8).
 *
 * §8 is explicit that the núcleo has to be measured before anything is layered
 * on top: *"medir respuesta→reunión→deal y costo por reunión"*. This is that
 * measurement.
 *
 * Deliberately built on events rather than on `leads.stage`. A stage is a
 * lead's current position and forgets everything it passed through — a lead
 * that replied and then went cold reads as `lost`, so a funnel derived from
 * stage counts under-reports every step above the bottom. Messages, replies and
 * outcomes are append-only, so counting them gives the funnel that actually
 * happened.
 */

export type FunnelInput = {
  /** Outbound messages that reached `sent` or `queued`. */
  sent: number;
  /** Distinct leads with at least one inbound reply. */
  replied: number;
  /** Replies triage classified as interested or a question. */
  positive: number;
  meetings: number;
  deals: number;
};

export type FunnelStep = {
  key: 'sent' | 'replied' | 'positive' | 'meetings' | 'deals';
  label: string;
  n: number;
  /** Share of the previous step, 0..1. Null when the previous step is empty. */
  ofPrevious: number | null;
  /** Share of the top of the funnel, 0..1. Null when nothing was sent. */
  ofSent: number | null;
};

const STEP_LABEL: Record<FunnelStep['key'], string> = {
  sent: 'Enviados',
  replied: 'Respondieron',
  positive: 'Respuesta positiva',
  meetings: 'Reuniones',
  deals: 'Cerrados',
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function conversionFunnel(input: FunnelInput): FunnelStep[] {
  const order: FunnelStep['key'][] = [
    'sent',
    'replied',
    'positive',
    'meetings',
    'deals',
  ];

  return order.map((key, i) => {
    const n = input[key];
    const previousKey = order[i - 1];
    const previous = previousKey === undefined ? null : input[previousKey];

    return {
      key,
      label: STEP_LABEL[key],
      n,
      ofPrevious: previous === null ? null : ratio(n, previous),
      ofSent: i === 0 ? null : ratio(n, input.sent),
    };
  });
}

/**
 * Model spend divided by meetings booked.
 *
 * This is model cost only — the traces table is the only spend the system
 * observes. Sourcing and enrichment are billed by third parties the engine does
 * not call yet, so presenting this as the full cost per meeting would flatter
 * the number by whatever Apollo and Anymail charge. Label it accordingly
 * wherever it is shown.
 */
export function costPer(spendUsd: number, count: number): number | null {
  return count > 0 ? spendUsd / count : null;
}

/* ------------------------------------------------------------------ A/B */

export type VariantInput = {
  variant: string;
  assigned: number;
  replied: number;
  meetings: number;
};

export type VariantResult = VariantInput & {
  replyRate: number | null;
  meetingRate: number | null;
  /** Reply-rate difference against the control, in percentage points. */
  liftPoints: number | null;
  /** Two-proportion z statistic against the control on reply rate. */
  z: number | null;
  significant: boolean;
};

/** Below this, a difference in reply rate is noise whatever the z says. */
export const MIN_SAMPLE = 30;
const Z_95 = 1.96;

/**
 * Compares experiment variants against the first one, which is the control.
 *
 * The significance test is a plain two-proportion z-test with a minimum sample
 * per arm. It is not a substitute for judgement, and it is here rather than in
 * the page so "is this real?" is answered by one tested function instead of by
 * whoever is looking at the bar chart.
 */
export function compareVariants(rows: readonly VariantInput[]): VariantResult[] {
  const sorted = [...rows].sort((a, b) => a.variant.localeCompare(b.variant));
  const control = sorted[0];

  return sorted.map((row) => {
    const replyRate = ratio(row.replied, row.assigned);
    const base =
      control && control.variant !== row.variant
        ? ratio(control.replied, control.assigned)
        : null;

    let z: number | null = null;
    if (
      control &&
      base !== null &&
      replyRate !== null &&
      row.assigned >= MIN_SAMPLE &&
      control.assigned >= MIN_SAMPLE
    ) {
      const pooled =
        (row.replied + control.replied) / (row.assigned + control.assigned);
      const se = Math.sqrt(
        pooled * (1 - pooled) * (1 / row.assigned + 1 / control.assigned),
      );
      z = se > 0 ? (replyRate - base) / se : null;
    }

    return {
      ...row,
      replyRate,
      meetingRate: ratio(row.meetings, row.assigned),
      liftPoints:
        base === null || replyRate === null ? null : (replyRate - base) * 100,
      z,
      significant: z !== null && Math.abs(z) > Z_95,
    };
  });
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null ? '—' : `${(value * 100).toFixed(digits)}%`;
}

export function formatUsd(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(2)}`;
}
