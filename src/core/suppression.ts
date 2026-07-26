import { emailDomain, normalizeEmail } from './email';

/**
 * Blocking pre-send suppression (spec §3.7).
 *
 * A suppression entry is either a full address (`ana@acme.com`) or a whole
 * domain (`@acme.com`). Matching is exact-after-normalization; there is no
 * fuzzy fallback, because a false negative here means mailing a customer or
 * someone who opted out.
 */

export type SuppressionReason =
  | 'unsubscribe'
  | 'customer'
  | 'open_deal'
  | 'bounce'
  | 'manual'
  | 'complaint';

export type SuppressionEntry = {
  value: string;
  reason: SuppressionReason | string;
};

export type SuppressionHit = {
  suppressed: true;
  matchedValue: string;
  reason: string;
};

export type SuppressionMiss = { suppressed: false };

export type SuppressionResult = SuppressionHit | SuppressionMiss;

/** Canonical storage form. Domain entries are stored with a leading `@`. */
export function suppressionKey(value: string): string {
  const normalized = normalizeEmail(value);
  if (normalized.startsWith('@')) return normalized;
  return normalized;
}

export function domainSuppressionKey(domain: string): string {
  const normalized = normalizeEmail(domain);
  return normalized.startsWith('@') ? normalized : `@${normalized}`;
}

/**
 * Returns the set of keys that would suppress `email`: the address itself and
 * its domain. Callers pass this straight to a single indexed `IN` query rather
 * than scanning the suppression table.
 */
export function suppressionLookupKeys(email: string): string[] {
  const address = normalizeEmail(email);
  const domain = emailDomain(address);
  return domain ? [address, `@${domain}`] : [address];
}

export function checkSuppression(
  email: string,
  entries: readonly SuppressionEntry[],
): SuppressionResult {
  const keys = new Set(suppressionLookupKeys(email));
  for (const entry of entries) {
    const key = suppressionKey(entry.value);
    if (keys.has(key)) {
      return { suppressed: true, matchedValue: key, reason: entry.reason };
    }
  }
  return { suppressed: false };
}
