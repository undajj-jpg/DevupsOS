import { describe, expect, it } from 'vitest';
import { planBatch, type AccountState, type BatchCandidate } from '@/core/batch';
import type { Mailbox } from '@/core/mailbox';

const NOW = new Date('2026-07-26T12:00:00Z');

function mailbox(id: string, cap: number, sentToday = 0): Mailbox {
  return {
    id,
    email: `${id}@send.devups.io`,
    warmupStage: 'steady',
    warmupStartedAt: new Date('2026-01-01T00:00:00Z'),
    dailyCap: cap,
    health: 1,
    status: 'active',
    sentToday,
    isPrimaryDomain: false,
  };
}

function candidate(
  leadId: string,
  email: string,
  score: number,
  accountId: string | null = null,
): BatchCandidate {
  return {
    leadId,
    contactId: `c-${leadId}`,
    accountId,
    email,
    score,
    optIn: false,
  };
}

const EMPTY = {
  suppressionEntries: [],
  accounts: new Map<string, AccountState>(),
  registry: new Map(),
  existingKeys: new Set<string>(),
  repliedLeadIds: new Set<string>(),
  now: NOW,
};

describe('batch planning', () => {
  it('plans in score order', () => {
    const plan = planBatch({
      campaignKey: 'daily',
      candidates: [
        candidate('low', 'low@x.com', 10),
        candidate('high', 'high@x.com', 90),
        candidate('mid', 'mid@x.com', 50),
      ],
      mailboxes: [mailbox('mb', 10)],
      ...EMPTY,
    });
    expect(plan.planned.map((p) => p.leadId)).toEqual(['high', 'mid', 'low']);
  });

  it('spreads sends across mailboxes instead of draining one', () => {
    const plan = planBatch({
      campaignKey: 'daily',
      candidates: [
        candidate('a', 'a@x.com', 50),
        candidate('b', 'b@x.com', 40),
        candidate('c', 'c@x.com', 30),
        candidate('d', 'd@x.com', 20),
      ],
      mailboxes: [mailbox('mb1', 2), mailbox('mb2', 2)],
      ...EMPTY,
    });
    const used = plan.planned.map((p) => p.mailboxId);
    expect(used.filter((m) => m === 'mb1')).toHaveLength(2);
    expect(used.filter((m) => m === 'mb2')).toHaveLength(2);
  });

  it('never exceeds total org capacity', () => {
    const plan = planBatch({
      campaignKey: 'daily',
      candidates: Array.from({ length: 20 }, (_, i) =>
        candidate(`l${i}`, `l${i}@x.com`, 50),
      ),
      mailboxes: [mailbox('mb', 3)],
      ...EMPTY,
    });
    expect(plan.planned).toHaveLength(3);
    expect(plan.skipped.filter((s) => s.reason === 'no_capacity')).toHaveLength(17);
  });

  it('a suppressed lead never consumes a mailbox slot', () => {
    const plan = planBatch({
      campaignKey: 'daily',
      candidates: [
        // Highest score, but blocked — the slot must go to the next lead.
        candidate('blocked', 'blocked@x.com', 99),
        candidate('clean', 'clean@x.com', 10),
      ],
      mailboxes: [mailbox('mb', 1)],
      ...EMPTY,
      suppressionEntries: [{ value: 'blocked@x.com', reason: 'customer' }],
    });

    expect(plan.planned.map((p) => p.leadId)).toEqual(['clean']);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['suppressed']);
  });

  it('skips leads inside the anti-resend cooldown', () => {
    const plan = planBatch({
      campaignKey: 'daily',
      candidates: [candidate('recent', 'recent@x.com', 80)],
      mailboxes: [mailbox('mb', 10)],
      ...EMPTY,
      registry: new Map([
        [
          'recent@x.com',
          {
            email: 'recent@x.com',
            lastContactedAt: new Date('2026-07-01T00:00:00Z'),
            timesContacted: 1,
          },
        ],
      ]),
    });
    expect(plan.planned).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('anti_resend');
  });

  it('is idempotent: replanning the same campaign produces no new sends', () => {
    const args = {
      campaignKey: 'daily',
      candidates: [candidate('a', 'a@x.com', 50)],
      mailboxes: [mailbox('mb', 10)],
      ...EMPTY,
    };
    const first = planBatch(args);
    const second = planBatch({
      ...args,
      existingKeys: new Set(first.planned.map((p) => p.dedupeKey)),
    });

    expect(first.planned).toHaveLength(1);
    expect(second.planned).toHaveLength(0);
    expect(second.skipped[0]?.reason).toBe('already_sent');
  });

  it('a customer account never consumes a mailbox slot either', () => {
    const plan = planBatch({
      campaignKey: 'daily',
      candidates: [
        candidate('customer', 'vp@acme.com', 99, 'acct-acme'),
        candidate('clean', 'clean@x.com', 10),
      ],
      mailboxes: [mailbox('mb', 1)],
      ...EMPTY,
      accounts: new Map<string, AccountState>([
        [
          'acct-acme',
          { name: 'Acme', relationship: 'customer', leadStages: [] },
        ],
      ]),
    });

    expect(plan.planned.map((p) => p.leadId)).toEqual(['clean']);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['existing_relationship']);
  });

  it('blocks a colleague of someone already at the meeting stage', () => {
    const plan = planBatch({
      campaignKey: 'daily',
      candidates: [candidate('new-guy', 'cto@acme.com', 80, 'acct-acme')],
      mailboxes: [mailbox('mb', 10)],
      ...EMPTY,
      accounts: new Map<string, AccountState>([
        [
          'acct-acme',
          {
            name: 'Acme',
            relationship: 'prospect',
            leadStages: [
              { leadId: 'colleague', stage: 'meeting' },
              { leadId: 'new-guy', stage: 'new' },
            ],
          },
        ],
      ]),
    });

    expect(plan.planned).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('active_deal');
  });

  it('does not let a lead block itself', () => {
    const plan = planBatch({
      campaignKey: 'daily',
      candidates: [candidate('solo', 'solo@acme.com', 80, 'acct-acme')],
      mailboxes: [mailbox('mb', 10)],
      ...EMPTY,
      accounts: new Map<string, AccountState>([
        [
          'acct-acme',
          {
            name: 'Acme',
            relationship: 'prospect',
            // The candidate's own row is in the account's lead list, and it is
            // at an active-deal stage. Only siblings may block.
            leadStages: [{ leadId: 'solo', stage: 'meeting' }],
          },
        ],
      ]),
    });

    expect(plan.planned.map((p) => p.leadId)).toEqual(['solo']);
  });

  it('plans nothing when no mailbox has capacity', () => {
    const plan = planBatch({
      campaignKey: 'daily',
      candidates: [candidate('a', 'a@x.com', 50)],
      mailboxes: [],
      ...EMPTY,
    });
    expect(plan.planned).toHaveLength(0);
    expect(plan.capacity).toBe(0);
  });
});
