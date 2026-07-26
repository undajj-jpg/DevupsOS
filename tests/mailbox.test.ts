import { describe, expect, it } from 'vitest';
import {
  computeHealth,
  effectiveDailyCap,
  orgDailyCapacity,
  selectMailbox,
  warmupAllowance,
  type Mailbox,
} from '@/core/mailbox';

const NOW = new Date('2026-07-26T12:00:00Z');

function mailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'mb-1',
    email: 'a@send.devups.io',
    warmupStage: 'steady',
    warmupStartedAt: new Date('2026-01-01T00:00:00Z'),
    dailyCap: 40,
    health: 1,
    status: 'active',
    sentToday: 0,
    isPrimaryDomain: false,
    ...overrides,
  };
}

describe('warmup schedule (§5 deliverability)', () => {
  it('ramps in steps rather than jumping to the full cap', () => {
    expect(warmupAllowance(0)).toBe(5);
    expect(warmupAllowance(5)).toBe(10);
    expect(warmupAllowance(10)).toBe(20);
    expect(warmupAllowance(30)).toBe(40);
  });

  it('never exceeds the operator cap, even late in warmup', () => {
    const cap = effectiveDailyCap(
      mailbox({ warmupStage: 'warming', dailyCap: 8 }),
      NOW,
    );
    expect(cap).toBe(8);
  });
});

describe('effective cap', () => {
  it('is zero for a paused or disabled mailbox', () => {
    expect(effectiveDailyCap(mailbox({ status: 'paused' }), NOW)).toBe(0);
    expect(effectiveDailyCap(mailbox({ warmupStage: 'paused' }), NOW)).toBe(0);
  });

  it('is zero below the health floor', () => {
    expect(effectiveDailyCap(mailbox({ health: 0.5 }), NOW)).toBe(0);
  });

  it('is zero on the primary domain, which is reserved from cold outreach', () => {
    expect(effectiveDailyCap(mailbox({ isPrimaryDomain: true }), NOW)).toBe(0);
  });
});

describe('rotation', () => {
  it('prefers the healthiest mailbox with headroom', () => {
    const chosen = selectMailbox(
      [
        mailbox({ id: 'low', email: 'low@x.io', health: 0.7 }),
        mailbox({ id: 'high', email: 'high@x.io', health: 0.95 }),
      ],
      NOW,
    );
    expect(chosen?.id).toBe('high');
  });

  it('returns null when every mailbox is at its cap — never a fallback send', () => {
    const chosen = selectMailbox(
      [mailbox({ dailyCap: 10, sentToday: 10 })],
      NOW,
    );
    expect(chosen).toBeNull();
  });

  it('sums only remaining headroom into org capacity', () => {
    const capacity = orgDailyCapacity(
      [
        mailbox({ id: 'a', email: 'a@x.io', dailyCap: 10, sentToday: 4 }),
        mailbox({ id: 'b', email: 'b@x.io', dailyCap: 10, sentToday: 10 }),
        mailbox({ id: 'c', email: 'c@x.io', dailyCap: 10, health: 0.1 }),
      ],
      NOW,
    );
    expect(capacity).toBe(6);
  });
});

describe('health scoring', () => {
  it('is 1 for a mailbox that has not sent yet', () => {
    expect(computeHealth({ sent: 0, bounced: 0, complaints: 0 })).toBe(1);
  });

  it('penalizes complaints far more heavily than bounces', () => {
    const bounceOnly = computeHealth({ sent: 100, bounced: 5, complaints: 0 });
    const complaintOnly = computeHealth({ sent: 100, bounced: 0, complaints: 5 });
    expect(complaintOnly).toBeLessThan(bounceOnly);
  });

  it('clamps to the 0..1 range', () => {
    expect(computeHealth({ sent: 10, bounced: 10, complaints: 10 })).toBe(0);
  });
});
