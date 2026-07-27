import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { planFollowUps, shouldCancelCadence } from '@/core/cadence';
import { prioritize, scoreLead } from '@/core/scoring';
import { backoffMs } from '@/lib/queue';
import { emailDomain, isFreemail, isValidEmail } from '@/core/email';
import { sortByStage, stageLabel } from '@/core/stages';

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('salts, so identical passwords produce different hashes', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects a malformed stored hash instead of throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1$2$3')).toBe(false);
  });
});

describe('follow-up cadence (§5)', () => {
  it('schedules three steps at +3d / +7d / +14d', () => {
    const plan = planFollowUps(new Date('2026-07-01T09:00:00Z'));
    expect(plan.map((p) => p.step)).toEqual([1, 2, 3]);
  });

  it('never schedules a send on a weekend', () => {
    const plan = planFollowUps(new Date('2026-07-01T09:00:00Z'));
    for (const item of plan) {
      expect([0, 6]).not.toContain(item.dueAt.getUTCDay());
    }
  });

  it('cancels on reply, opt-out, suppression or a booked meeting', () => {
    const base = {
      hasReplied: false,
      optedOut: false,
      suppressed: false,
      meetingBooked: false,
    };
    expect(shouldCancelCadence(base).cancel).toBe(false);
    expect(shouldCancelCadence({ ...base, hasReplied: true }).reason).toBe('replied');
    expect(shouldCancelCadence({ ...base, optedOut: true }).reason).toBe('opted_out');
    expect(shouldCancelCadence({ ...base, meetingBooked: true }).reason).toBe(
      'meeting_booked',
    );
  });
});

describe('lead scoring', () => {
  const strong = {
    hasSignal: true,
    emailVerified: true,
    title: 'VP Engineering',
    employeeCount: 300,
    techStack: ['TypeScript', 'AWS'],
    language: 'en',
  };

  it('ranks a signal-backed, verified, on-ICP lead highly', () => {
    expect(scoreLead(strong)).toBeGreaterThan(80);
  });

  it('penalizes a lead with no trigger', () => {
    expect(scoreLead({ ...strong, hasSignal: false })).toBeLessThan(
      scoreLead(strong),
    );
  });

  it('stays within 0..100', () => {
    const score = scoreLead(strong);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('breaks ties deterministically so batches are reproducible', () => {
    const input = [
      { id: 'b', score: 50 },
      { id: 'a', score: 50 },
    ];
    expect(prioritize(input).map((l) => l.id)).toEqual(['a', 'b']);
  });
});

describe('queue backoff', () => {
  it('grows exponentially', () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(240_000);
  });

  it('is capped at one hour', () => {
    expect(backoffMs(50)).toBe(3_600_000);
  });
});

describe('email helpers', () => {
  it('accepts a normal address and rejects malformed ones', () => {
    expect(isValidEmail('Ana.Perez@Acme.co.uk')).toBe(true);
    expect(isValidEmail('ana@acme')).toBe(false);
    expect(isValidEmail('ana @acme.com')).toBe(false);
    expect(isValidEmail('@acme.com')).toBe(false);
  });

  it('extracts the domain from the last @', () => {
    expect(emailDomain('a@b@acme.com')).toBe('acme.com');
  });

  it('identifies freemail providers', () => {
    expect(isFreemail('a@gmail.com')).toBe(true);
    expect(isFreemail('a@acme.com')).toBe(false);
  });
});

describe('funnel stage ordering', () => {
  it('renders the pipeline in funnel order, not GROUP BY order', () => {
    // A SQL GROUP BY returns rows in planner order; the funnel must not.
    const scrambled = [
      { stage: 'lost' },
      { stage: 'new' },
      { stage: 'won' },
      { stage: 'queued' },
    ];
    expect(sortByStage(scrambled).map((s) => s.stage)).toEqual([
      'new',
      'queued',
      'won',
      'lost',
    ]);
  });

  it('puts unknown stages last rather than dropping them', () => {
    const rows = [{ stage: 'custom' }, { stage: 'new' }];
    expect(sortByStage(rows).map((s) => s.stage)).toEqual(['new', 'custom']);
  });

  it('falls back to the raw key when a stage has no label', () => {
    expect(stageLabel('new')).toBe('Nuevos');
    expect(stageLabel('bespoke')).toBe('bespoke');
  });
});
