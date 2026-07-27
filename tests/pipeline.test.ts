import { describe, expect, it } from 'vitest';
import {
  buildBoard,
  checkStageTransition,
  DEFAULT_STAGES,
  funnelStages,
  type BoardCard,
} from '@/core/pipeline';

function card(over: Partial<BoardCard> & { id: string; stage: string }): BoardCard {
  return {
    fullName: over.id,
    email: `${over.id}@x.com`,
    company: null,
    score: 0,
    closeProbability: null,
    tags: [],
    updatedAt: new Date('2026-07-26T00:00:00Z'),
    ...over,
  };
}

describe('funnel stages', () => {
  it('falls back to the canonical order when a funnel has none', () => {
    expect(funnelStages(null)).toEqual(DEFAULT_STAGES);
    expect(funnelStages({ stages: [] })).toEqual(DEFAULT_STAGES);
  });

  it('sorts a configured funnel by its own order, not insertion order', () => {
    const stages = funnelStages({
      stages: [
        { key: 'b', label: 'B', order: 2 },
        { key: 'a', label: 'A', order: 1 },
      ],
    });
    expect(stages.map((s) => s.key)).toEqual(['a', 'b']);
  });
});

describe('board projection', () => {
  const stages = [
    { key: 'new', label: 'Nuevos', order: 0 },
    { key: 'replied', label: 'Respondieron', order: 1 },
  ];

  it('keeps empty columns so the funnel shape stays visible', () => {
    const board = buildBoard(stages, [card({ id: 'a', stage: 'new' })]);
    expect(board.map((c) => c.key)).toEqual(['new', 'replied']);
    expect(board[1]?.cards).toHaveLength(0);
  });

  it('ranks a column by close probability, then score', () => {
    const board = buildBoard(stages, [
      card({ id: 'low-prob', stage: 'new', closeProbability: 10, score: 99 }),
      card({ id: 'high-prob', stage: 'new', closeProbability: 80, score: 1 }),
      card({ id: 'no-prob-high-score', stage: 'new', score: 50 }),
    ]);
    expect(board[0]?.cards.map((c) => c.id)).toEqual([
      'high-prob',
      'low-prob',
      'no-prob-high-score',
    ]);
  });

  it('surfaces a lead whose stage is not in the funnel instead of dropping it', () => {
    const board = buildBoard(stages, [card({ id: 'orphan', stage: 'proposal' })]);
    expect(board.map((c) => c.key)).toEqual(['new', 'replied', 'proposal']);
    expect(board[2]?.label).toBe('Propuesta');
  });
});

describe('stage transitions', () => {
  it('allows an ordinary move', () => {
    expect(checkStageTransition('new', 'contacted', DEFAULT_STAGES).allowed).toBe(
      true,
    );
  });

  it('refuses a no-op', () => {
    expect(checkStageTransition('new', 'new', DEFAULT_STAGES).allowed).toBe(false);
  });

  it('refuses a stage the funnel does not have', () => {
    const result = checkStageTransition('new', 'invented', DEFAULT_STAGES);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.detail).toContain('not a stage');
  });

  it('refuses to hand-set a stage the batch owns', () => {
    // A lead in `queued` claims to have a message in today's batch. Setting it
    // by hand produces a lead that claims a batch entry that does not exist.
    const result = checkStageTransition('new', 'queued', DEFAULT_STAGES);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.detail).toContain('by the batch');
  });
});
