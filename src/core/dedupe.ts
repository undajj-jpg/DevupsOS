import { createHash } from 'node:crypto';
import { normalizeEmail } from './email';

/**
 * Anti-resend (spec §5). The contacted registry records every address any
 * mailbox in the org has ever written to — including messages sent by hand,
 * outside the engine — so a prospect one rep already emailed is never cold-
 * mailed by the machine.
 */

export type RegistryEntry = {
  email: string;
  lastContactedAt: Date;
  timesContacted: number;
};

export type AntiResendPolicy = {
  /** Never re-contact within this window regardless of other rules. */
  cooldownDays: number;
  /** Hard ceiling on total touches per address, across all campaigns. */
  maxTouches: number;
};

export const DEFAULT_ANTI_RESEND: AntiResendPolicy = {
  cooldownDays: 180,
  maxTouches: 3,
};

export type AntiResendResult =
  | { allowed: true }
  | { allowed: false; reason: 'cooldown' | 'max_touches'; detail: string };

export function checkAntiResend(
  email: string,
  entry: RegistryEntry | null | undefined,
  policy: AntiResendPolicy = DEFAULT_ANTI_RESEND,
  now: Date = new Date(),
): AntiResendResult {
  if (!entry) return { allowed: true };
  if (normalizeEmail(entry.email) !== normalizeEmail(email)) {
    // Defensive: a mismatched entry means the caller looked up the wrong row.
    // Treat it as a block rather than silently permitting the send.
    return {
      allowed: false,
      reason: 'cooldown',
      detail: 'registry entry does not match the target address',
    };
  }

  if (entry.timesContacted >= policy.maxTouches) {
    return {
      allowed: false,
      reason: 'max_touches',
      detail: `already contacted ${entry.timesContacted} times (max ${policy.maxTouches})`,
    };
  }

  const elapsedDays =
    (now.getTime() - entry.lastContactedAt.getTime()) / 86_400_000;
  if (elapsedDays < policy.cooldownDays) {
    const remaining = Math.ceil(policy.cooldownDays - elapsedDays);
    return {
      allowed: false,
      reason: 'cooldown',
      detail: `contacted ${Math.floor(elapsedDays)}d ago; ${remaining}d of cooldown remain`,
    };
  }

  return { allowed: true };
}

/**
 * Idempotency key for a send (spec §3.6). Derived only from stable identity —
 * lead, campaign, step — so a retried job resolves to the same key and the
 * unique index on messages rejects the duplicate.
 */
export function sendDedupeKey(input: {
  leadId: string;
  campaignKey: string;
  step: number;
}): string {
  const material = `${input.leadId}:${input.campaignKey}:${input.step}`;
  return createHash('sha256').update(material).digest('hex').slice(0, 40);
}
