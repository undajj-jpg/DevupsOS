import { describe, expect, it } from 'vitest';
import { checkSendEligibility } from '@/core/eligibility';
import { checkAntiResend, sendDedupeKey } from '@/core/dedupe';

const base = {
  email: 'lead@target.com',
  existingMessageForKey: null,
  suppression: [],
  registryEntry: null,
  optIn: false,
  hasReplied: false,
};

describe('send eligibility (guardrails §3.6, §3.7)', () => {
  it('allows a clean cold lead', () => {
    expect(checkSendEligibility(base).eligible).toBe(true);
  });

  it('rejects an unparseable address before anything else', () => {
    const result = checkSendEligibility({ ...base, email: 'not-an-email' });
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe('invalid_email');
  });

  it('suppression outranks an explicit opt-in', () => {
    const result = checkSendEligibility({
      ...base,
      optIn: true,
      suppression: [{ value: 'lead@target.com', reason: 'unsubscribe' }],
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe('suppressed');
  });

  it('is checked before the already-sent guard, so a blocked lead is reported as suppressed', () => {
    const result = checkSendEligibility({
      ...base,
      suppression: [{ value: 'lead@target.com', reason: 'customer' }],
      existingMessageForKey: { id: 'msg-1' },
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe('suppressed');
  });

  it('refuses a second send for the same dedupe key', () => {
    const result = checkSendEligibility({
      ...base,
      existingMessageForKey: { id: 'msg-1' },
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe('already_sent');
  });

  it('stops the cadence once the lead has replied', () => {
    const result = checkSendEligibility({ ...base, hasReplied: true });
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe('replied');
  });

  it('blocks a cold re-contact inside the cooldown window', () => {
    const result = checkSendEligibility({
      ...base,
      registryEntry: {
        email: 'lead@target.com',
        lastContactedAt: new Date('2026-07-01T00:00:00Z'),
        timesContacted: 1,
      },
      now: new Date('2026-07-20T00:00:00Z'),
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe('anti_resend');
  });

  it('permits a re-contact once the cooldown has elapsed', () => {
    const result = checkSendEligibility({
      ...base,
      registryEntry: {
        email: 'lead@target.com',
        lastContactedAt: new Date('2025-01-01T00:00:00Z'),
        timesContacted: 1,
      },
      now: new Date('2026-07-20T00:00:00Z'),
    });
    expect(result.eligible).toBe(true);
  });

  it('exempts opted-in contacts from the cold anti-resend ledger', () => {
    const result = checkSendEligibility({
      ...base,
      optIn: true,
      registryEntry: {
        email: 'lead@target.com',
        lastContactedAt: new Date('2026-07-19T00:00:00Z'),
        timesContacted: 2,
      },
      now: new Date('2026-07-20T00:00:00Z'),
    });
    expect(result.eligible).toBe(true);
  });
});

describe('anti-resend ledger', () => {
  it('blocks once the touch ceiling is reached, regardless of age', () => {
    const result = checkAntiResend(
      'lead@target.com',
      {
        email: 'lead@target.com',
        lastContactedAt: new Date('2020-01-01T00:00:00Z'),
        timesContacted: 3,
      },
      { cooldownDays: 180, maxTouches: 3 },
      new Date('2026-07-20T00:00:00Z'),
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('max_touches');
  });

  it('treats a mismatched registry row as a block rather than a pass', () => {
    const result = checkAntiResend('lead@target.com', {
      email: 'someone-else@target.com',
      lastContactedAt: new Date('2020-01-01T00:00:00Z'),
      timesContacted: 0,
    });
    expect(result.allowed).toBe(false);
  });
});

describe('dedupe keys (idempotency)', () => {
  it('is stable for the same lead, campaign and step', () => {
    const args = { leadId: 'lead-1', campaignKey: 'daily', step: 0 };
    expect(sendDedupeKey(args)).toBe(sendDedupeKey(args));
  });

  it('differs across steps and campaigns', () => {
    const a = sendDedupeKey({ leadId: 'l', campaignKey: 'daily', step: 0 });
    const b = sendDedupeKey({ leadId: 'l', campaignKey: 'daily', step: 1 });
    const c = sendDedupeKey({ leadId: 'l', campaignKey: 'other', step: 0 });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
