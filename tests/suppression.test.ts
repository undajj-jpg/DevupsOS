import { describe, expect, it } from 'vitest';
import {
  checkSuppression,
  domainSuppressionKey,
  suppressionLookupKeys,
} from '@/core/suppression';

describe('suppression (guardrail §3.7 — blocking pre-send)', () => {
  it('blocks an exact address match', () => {
    const result = checkSuppression('ana@acme.com', [
      { value: 'ana@acme.com', reason: 'unsubscribe' },
    ]);
    expect(result.suppressed).toBe(true);
    if (result.suppressed) expect(result.reason).toBe('unsubscribe');
  });

  it('normalizes case and surrounding whitespace before matching', () => {
    const result = checkSuppression('  ANA@Acme.COM ', [
      { value: 'ana@acme.com', reason: 'customer' },
    ]);
    expect(result.suppressed).toBe(true);
  });

  it('blocks the whole domain when a domain entry exists', () => {
    const result = checkSuppression('anyone@acme.com', [
      { value: domainSuppressionKey('acme.com'), reason: 'customer' },
    ]);
    expect(result.suppressed).toBe(true);
    if (result.suppressed) expect(result.matchedValue).toBe('@acme.com');
  });

  it('does not match a different domain that shares a suffix', () => {
    const result = checkSuppression('ana@notacme.com', [
      { value: '@acme.com', reason: 'customer' },
    ]);
    expect(result.suppressed).toBe(false);
  });

  it('does not treat a local-part collision as a domain block', () => {
    const result = checkSuppression('acme.com@gmail.com', [
      { value: '@acme.com', reason: 'customer' },
    ]);
    expect(result.suppressed).toBe(false);
  });

  it('produces exactly the address and domain keys for an indexed lookup', () => {
    expect(suppressionLookupKeys('Ana@Acme.com')).toEqual([
      'ana@acme.com',
      '@acme.com',
    ]);
  });

  it('passes an address with no matching entry', () => {
    expect(
      checkSuppression('new@lead.com', [
        { value: 'other@lead.com', reason: 'bounce' },
      ]).suppressed,
    ).toBe(false);
  });
});
