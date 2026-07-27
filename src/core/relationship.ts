/**
 * Suppression of our own people (plataforma-completa, Gobierno §1; hardening
 * checklist §8, marked BLOQUEANTE).
 *
 * The `suppression` table catches unsubscribes, bounces and manual do-not-
 * contact entries. It does not catch the most expensive mistake in outbound:
 * cold-emailing a current customer, a partner, or someone whose colleague is
 * already mid-deal with us. Those addresses are perfectly deliverable and
 * nobody ever remembers to add them by hand.
 *
 * So the relationship itself is the block. It is derived state — read from
 * `accounts.relationship` and from the stages of the other leads on the same
 * account — which means it stays correct as deals move without anyone
 * maintaining a list.
 */

/** Stages that mean somebody at this account is already in a conversation. */
export const ACTIVE_DEAL_STAGES = ['meeting', 'proposal', 'won'] as const;

/** Relationships that are not cold-outreach targets, whatever the stage says. */
export const PROTECTED_RELATIONSHIPS = ['customer', 'partner'] as const;

export type RelationshipBlockReason = 'existing_relationship' | 'active_deal';

export type RelationshipInput = {
  /** `accounts.relationship` for the lead's account, or null if unlinked. */
  relationship: string | null;
  /**
   * Stages of the *other* leads on the same account. A lead does not block
   * itself — otherwise a lead that reached `meeting` could never be followed
   * up within its own thread.
   */
  siblingStages?: readonly string[];
  /** Account name, used only to make the block message readable. */
  accountName?: string | null;
};

export type RelationshipResult =
  | { blocked: false }
  | { blocked: true; reason: RelationshipBlockReason; detail: string };

export function checkRelationship(input: RelationshipInput): RelationshipResult {
  const relationship = input.relationship?.trim().toLowerCase() ?? null;
  const where = input.accountName ? ` at ${input.accountName}` : '';

  if (
    relationship !== null &&
    (PROTECTED_RELATIONSHIPS as readonly string[]).includes(relationship)
  ) {
    return {
      blocked: true,
      reason: 'existing_relationship',
      detail: `account${where} is a ${relationship}; cold outreach is blocked`,
    };
  }

  const active = (input.siblingStages ?? []).find((stage) =>
    (ACTIVE_DEAL_STAGES as readonly string[]).includes(stage),
  );
  if (active) {
    return {
      blocked: true,
      reason: 'active_deal',
      detail: `another lead${where} is at stage "${active}"; cold outreach is blocked`,
    };
  }

  return { blocked: false };
}
