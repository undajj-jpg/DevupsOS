import { describe, expect, it } from 'vitest';
import {
  detectOptOut,
  heuristicClassify,
  requiresSuppression,
  shouldStopCadence,
} from '@/core/triage';

describe('opt-out detection (deterministic, not model-dependent)', () => {
  it.each([
    'Please unsubscribe me from this list',
    'Remove me from your database',
    'Stop emailing me',
    'Do not contact me again',
    'Por favor, denme de baja',
    'No me contacten más',
    'Não me envie mais emails',
  ])('recognizes %j', (body) => {
    expect(detectOptOut(body)).toBe(true);
  });

  it('does not fire on an ordinary decline', () => {
    expect(detectOptOut('Thanks, but we are not hiring right now.')).toBe(false);
  });

  it('classifies an opt-out without needing the model', () => {
    const result = heuristicClassify('please unsubscribe');
    expect(result.category).toBe('unsubscribe');
    expect(result.optOutDetected).toBe(true);
    expect(result.closeProbability).toBe(0);
  });

  it('routes anything it cannot classify to a human rather than guessing', () => {
    const result = heuristicClassify('¿Cuánto cobran?');
    expect(result.category).toBe('other');
    expect(result.confidence).toBe(0);
  });
});

describe('cadence and suppression routing', () => {
  it('stops the cadence on a real reply', () => {
    expect(shouldStopCadence('interested')).toBe(true);
    expect(shouldStopCadence('not_interested')).toBe(true);
  });

  it('keeps the cadence alive through absence and auto notices', () => {
    expect(shouldStopCadence('out_of_office')).toBe(false);
    expect(shouldStopCadence('auto_reply')).toBe(false);
  });

  it('suppresses on an opt-out flag even when the category disagrees', () => {
    expect(
      requiresSuppression({
        category: 'other',
        sentiment: 'neutral',
        closeProbability: 0,
        optOutDetected: true,
        reasoning: '',
        confidence: 1,
      }),
    ).toBe(true);
  });
});

describe('opt-out false positives', () => {
  it('does not treat Spanish sick-leave phrasing as an opt-out', () => {
    // "estar de baja" means on sick leave. Suppressing on it would silently
    // remove people who never asked to be removed.
    expect(detectOptOut('Ana está de baja hasta el lunes.')).toBe(false);
  });

  it('does not fire on the word "stop" in ordinary prose', () => {
    expect(detectOptOut('We had to stop the project last quarter.')).toBe(false);
  });
});
