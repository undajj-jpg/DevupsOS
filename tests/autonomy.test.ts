import { describe, expect, it } from 'vitest';
import {
  evaluateAutonomyGate,
  requiresHumanApproval,
  resolveAgentMode,
  type AutonomyChecklist,
} from '@/core/autonomy';

const ALL_TRUE: AutonomyChecklist = {
  secretsManaged: true,
  promptInjectionDefense: true,
  authAndRls: true,
  humanInTheLoop: true,
  killSwitch: true,
  schedulerAndIdempotency: true,
  blockingSuppression: true,
};

describe('autonomy gate (§10 — blocking)', () => {
  it('passes only when every requirement is met', () => {
    expect(evaluateAutonomyGate(ALL_TRUE).passed).toBe(true);
  });

  it('fails and names what is missing', () => {
    const result = evaluateAutonomyGate({ ...ALL_TRUE, killSwitch: false });
    expect(result.passed).toBe(false);
    expect(result.missing).toEqual(['killSwitch']);
  });
});

describe('agent mode resolution (§3.5)', () => {
  const autonomous = {
    orgAgentsEnabled: true,
    orgAutonomyGatePassed: true,
    agentEnabled: true,
    agentMode: 'autonomous' as const,
    forceSuggestionMode: false,
  };

  it('grants autonomy only when every layer agrees', () => {
    const decision = resolveAgentMode(autonomous);
    expect(decision).toEqual({ allowed: true, mode: 'autonomous' });
  });

  it('the global kill switch stops the agent outright', () => {
    const decision = resolveAgentMode({ ...autonomous, orgAgentsEnabled: false });
    expect(decision.allowed).toBe(false);
  });

  it('a per-agent kill switch stops that agent outright', () => {
    const decision = resolveAgentMode({ ...autonomous, agentEnabled: false });
    expect(decision.allowed).toBe(false);
  });

  it('an unpassed gate downgrades to suggestion rather than refusing', () => {
    const decision = resolveAgentMode({
      ...autonomous,
      orgAutonomyGatePassed: false,
    });
    expect(decision).toEqual({ allowed: true, mode: 'suggest' });
  });

  it('the env override pins suggestion mode even with the gate passed', () => {
    const decision = resolveAgentMode({ ...autonomous, forceSuggestionMode: true });
    expect(decision).toEqual({ allowed: true, mode: 'suggest' });
  });
});

describe('human-in-the-loop', () => {
  it('requires approval for every action while in suggestion mode', () => {
    expect(requiresHumanApproval('get_stats', 'suggest')).toBe(true);
  });

  it('still requires approval for irreversible actions when autonomous', () => {
    expect(requiresHumanApproval('send_batch', 'autonomous')).toBe(true);
    expect(requiresHumanApproval('add_suppression', 'autonomous')).toBe(true);
    expect(requiresHumanApproval('book_meeting', 'autonomous')).toBe(true);
  });

  it('lets an autonomous agent run read-only tools unattended', () => {
    expect(requiresHumanApproval('get_stats', 'autonomous')).toBe(false);
  });
});
