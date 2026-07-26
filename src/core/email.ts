/**
 * Email normalization. Every suppression check, registry lookup and dedupe key
 * runs through this, so two spellings of the same mailbox can never resolve to
 * different rows and slip past a block.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidEmail(input: string): boolean {
  const value = normalizeEmail(input);
  return value.length <= 254 && EMAIL_RE.test(value);
}

export function emailDomain(input: string): string | null {
  const value = normalizeEmail(input);
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return null;
  return value.slice(at + 1);
}

/** Free-mail providers are never treated as company domains when matching. */
const FREEMAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
]);

export function isFreemail(input: string): boolean {
  const domain = emailDomain(input);
  return domain !== null && FREEMAIL.has(domain);
}
