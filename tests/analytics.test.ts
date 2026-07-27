import { describe, expect, it } from 'vitest';
import {
  compareVariants,
  conversionFunnel,
  costPer,
  formatPercent,
  MIN_SAMPLE,
} from '@/core/analytics';

describe('conversion funnel', () => {
  const input = {
    sent: 200,
    replied: 20,
    positive: 8,
    meetings: 4,
    deals: 1,
  };

  it('reports each step against the previous one and against the top', () => {
    const steps = conversionFunnel(input);
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));

    expect(byKey.replied?.ofPrevious).toBeCloseTo(0.1);
    expect(byKey.meetings?.ofPrevious).toBeCloseTo(0.5);
    expect(byKey.meetings?.ofSent).toBeCloseTo(0.02);
  });

  it('has no rate for the top of the funnel', () => {
    const [top] = conversionFunnel(input);
    expect(top?.ofPrevious).toBeNull();
    expect(top?.ofSent).toBeNull();
  });

  it('returns null rather than NaN or Infinity on an empty funnel', () => {
    const steps = conversionFunnel({
      sent: 0,
      replied: 0,
      positive: 0,
      meetings: 0,
      deals: 0,
    });
    for (const step of steps) {
      expect(step.ofPrevious).not.toBeNaN();
      expect(step.ofSent).not.toBeNaN();
    }
    expect(steps[1]?.ofPrevious).toBeNull();
    expect(formatPercent(steps[1]?.ofPrevious ?? null)).toBe('—');
  });
});

describe('cost per outcome', () => {
  it('divides spend by the count', () => {
    expect(costPer(40, 4)).toBe(10);
  });

  it('is null with no outcomes, never a division by zero', () => {
    expect(costPer(40, 0)).toBeNull();
  });
});

describe('A/B comparison', () => {
  const control = { variant: 'a-control', assigned: 500, replied: 25, meetings: 5 };

  it('measures the control against itself as no lift', () => {
    const [first] = compareVariants([control]);
    expect(first?.liftPoints).toBeNull();
    expect(first?.significant).toBe(false);
  });

  it('flags a large, well-sampled difference as significant', () => {
    const results = compareVariants([
      control,
      { variant: 'b-personalized', assigned: 500, replied: 75, meetings: 20 },
    ]);
    const variant = results.find((r) => r.variant === 'b-personalized');
    expect(variant?.liftPoints).toBeCloseTo(10, 5);
    expect(variant?.significant).toBe(true);
  });

  it('refuses to call a small sample significant, however large the gap', () => {
    // 0% vs 100% — the most extreme difference possible, on 10 leads a side.
    const results = compareVariants([
      { variant: 'a', assigned: MIN_SAMPLE - 1, replied: 0, meetings: 0 },
      {
        variant: 'b',
        assigned: MIN_SAMPLE - 1,
        replied: MIN_SAMPLE - 1,
        meetings: 0,
      },
    ]);
    expect(results.every((r) => !r.significant)).toBe(true);
    expect(results[1]?.z).toBeNull();
  });

  it('treats the alphabetically first variant as the control, deterministically', () => {
    const forward = compareVariants([
      { variant: 'b', assigned: 100, replied: 10, meetings: 1 },
      { variant: 'a', assigned: 100, replied: 5, meetings: 1 },
    ]);
    const reversed = compareVariants([
      { variant: 'a', assigned: 100, replied: 5, meetings: 1 },
      { variant: 'b', assigned: 100, replied: 10, meetings: 1 },
    ]);
    expect(forward.map((r) => r.liftPoints)).toEqual(
      reversed.map((r) => r.liftPoints),
    );
    expect(forward[1]?.liftPoints).toBeCloseTo(5, 5);
  });
});
