import { isValidEmail, normalizeEmail } from './email';
import {
  checkSuppression,
  type SuppressionEntry,
  type SuppressionResult,
} from './suppression';
import {
  checkAntiResend,
  DEFAULT_ANTI_RESEND,
  type AntiResendPolicy,
  type RegistryEntry,
} from './dedupe';

/**
 * The single pre-send gate (spec §3.7, §5).
 *
 * Every path that produces an outbound message — the daily batch, a follow-up,
 * an approved draft — calls this. The order matters: the cheapest and most
 * consequential checks run first, and the function returns on the first block
 * so a suppressed address is never even considered for a mailbox slot.
 */

export type EligibilityInput = {
  email: string;
  /** Already-sent message for this (lead, campaign, step), if any. */
  existingMessageForKey: { id: string } | null;
  suppression: readonly SuppressionEntry[];
  registryEntry: RegistryEntry | null;
  /** False for a cold first touch; true once the lead consented. */
  optIn: boolean;
  hasReplied: boolean;
  antiResendPolicy?: AntiResendPolicy;
  now?: Date;
};

export type BlockReason =
  | 'invalid_email'
  | 'suppressed'
  | 'already_sent'
  | 'anti_resend'
  | 'replied';

export type EligibilityResult =
  | { eligible: true; email: string }
  | { eligible: false; reason: BlockReason; detail: string };

export function checkSendEligibility(
  input: EligibilityInput,
): EligibilityResult {
  const email = normalizeEmail(input.email);

  if (!isValidEmail(email)) {
    return {
      eligible: false,
      reason: 'invalid_email',
      detail: `"${input.email}" is not a deliverable address`,
    };
  }

  // Suppression first and unconditionally — it outranks every other rule,
  // including an explicit opt-in, because unsubscribes and live customers
  // must never receive outreach.
  const suppressed: SuppressionResult = checkSuppression(
    email,
    input.suppression,
  );
  if (suppressed.suppressed) {
    return {
      eligible: false,
      reason: 'suppressed',
      detail: `blocked by suppression entry ${suppressed.matchedValue} (${suppressed.reason})`,
    };
  }

  // Idempotency: the same dedupe key must never produce a second send, even if
  // a job is retried after a partial failure.
  if (input.existingMessageForKey) {
    return {
      eligible: false,
      reason: 'already_sent',
      detail: `message ${input.existingMessageForKey.id} already exists for this dedupe key`,
    };
  }

  // A reply ends the cadence (§5 follow-up rules).
  if (input.hasReplied) {
    return {
      eligible: false,
      reason: 'replied',
      detail: 'lead has replied; cadence is closed',
    };
  }

  // Opted-in contacts are in an existing conversation, so the cold-outreach
  // anti-resend ledger does not apply to them.
  if (!input.optIn) {
    const antiResend = checkAntiResend(
      email,
      input.registryEntry,
      input.antiResendPolicy ?? DEFAULT_ANTI_RESEND,
      input.now ?? new Date(),
    );
    if (!antiResend.allowed) {
      return {
        eligible: false,
        reason: 'anti_resend',
        detail: antiResend.detail,
      };
    }
  }

  return { eligible: true, email };
}
