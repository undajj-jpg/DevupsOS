/**
 * Multi-mailbox sending: warmup, daily caps, rotation and health (spec §5).
 *
 * The ramp is deliberately slow. A cold Google Workspace mailbox that jumps to
 * 50/day gets filtered, and the reputation damage lands on the domain, not just
 * the address — which is why primary domains are excluded from cold sending.
 */

export type WarmupStage = 'warming' | 'ramping' | 'steady' | 'paused';

export type Mailbox = {
  id: string;
  email: string;
  warmupStage: WarmupStage;
  warmupStartedAt: Date | null;
  /** Operator-set ceiling. The warmup schedule can only lower it, never raise. */
  dailyCap: number;
  /** 0..1 deliverability score from bounce/complaint/placement signals. */
  health: number;
  status: 'active' | 'paused' | 'disabled';
  sentToday: number;
  isPrimaryDomain: boolean;
};

/** Day N of warmup -> allowance. Roughly doubles weekly, capped at 40. */
export function warmupAllowance(daysWarming: number): number {
  if (daysWarming < 0) return 0;
  if (daysWarming < 3) return 5;
  if (daysWarming < 7) return 10;
  if (daysWarming < 14) return 20;
  if (daysWarming < 21) return 30;
  return 40;
}

export function daysSince(start: Date | null, now: Date): number {
  if (!start) return 0;
  return Math.floor((now.getTime() - start.getTime()) / 86_400_000);
}

/** Health below this means the mailbox stops sending until a human looks. */
export const HEALTH_FLOOR = 0.6;

export function effectiveDailyCap(mailbox: Mailbox, now: Date = new Date()): number {
  if (mailbox.status !== 'active') return 0;
  if (mailbox.warmupStage === 'paused') return 0;
  if (mailbox.health < HEALTH_FLOOR) return 0;
  // The primary domain is reserved for real conversations; cold volume goes
  // through secondary domains so an inbox-placement problem stays contained.
  if (mailbox.isPrimaryDomain) return 0;

  const operatorCap = Math.max(0, mailbox.dailyCap);
  if (mailbox.warmupStage === 'steady') return operatorCap;

  const scheduled = warmupAllowance(daysSince(mailbox.warmupStartedAt, now));
  return Math.min(operatorCap, scheduled);
}

export function remainingCapacity(mailbox: Mailbox, now: Date = new Date()): number {
  return Math.max(0, effectiveDailyCap(mailbox, now) - mailbox.sentToday);
}

/**
 * Picks the mailbox to send from: healthiest first, then most remaining
 * headroom. Returns null when nothing has capacity — the caller must treat
 * that as "do not send", never as "send anyway".
 */
export function selectMailbox(
  mailboxes: readonly Mailbox[],
  now: Date = new Date(),
): Mailbox | null {
  const eligible = mailboxes
    .map((m) => ({ mailbox: m, capacity: remainingCapacity(m, now) }))
    .filter((m) => m.capacity > 0);

  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    if (b.mailbox.health !== a.mailbox.health) {
      return b.mailbox.health - a.mailbox.health;
    }
    if (b.capacity !== a.capacity) return b.capacity - a.capacity;
    return a.mailbox.email.localeCompare(b.mailbox.email);
  });

  return eligible[0]!.mailbox;
}

/** Total sends the org can make today across every eligible mailbox. */
export function orgDailyCapacity(
  mailboxes: readonly Mailbox[],
  now: Date = new Date(),
): number {
  return mailboxes.reduce((sum, m) => sum + remainingCapacity(m, now), 0);
}

/**
 * Recomputes health from recent delivery telemetry. Bounces are weighted an
 * order of magnitude below complaints — a spam report costs far more.
 */
export function computeHealth(stats: {
  sent: number;
  bounced: number;
  complaints: number;
}): number {
  if (stats.sent <= 0) return 1;
  const bounceRate = stats.bounced / stats.sent;
  const complaintRate = stats.complaints / stats.sent;
  const score = 1 - bounceRate * 2 - complaintRate * 20;
  return Math.max(0, Math.min(1, score));
}
