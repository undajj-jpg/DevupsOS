/**
 * Core data model (spec §4). Every business table carries `org_id`; RLS
 * policies in db/migrations/0001_rls.sql are the source of isolation.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const id = () => uuid('id').primaryKey().defaultRandom();
const orgId = () => uuid('org_id').notNull();
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ tenancy */

export const orgs = pgTable('orgs', {
  id: id(),
  name: text('name').notNull(),
  // Global kill switch (guardrail §3.5). When false, no agent may act.
  agentsEnabled: boolean('agents_enabled').notNull().default(true),
  // Autonomy gate (§10). Until passed, agents only propose.
  autonomyGatePassed: boolean('autonomy_gate_passed').notNull().default(false),
  physicalAddress: text('physical_address'),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    orgId: orgId(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    // owner | admin | member
    role: text('role').notNull().default('member'),
    passwordHash: text('password_hash').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
);

/** Row-level share: grants one user visibility on one record. */
export const visibilityGrants = pgTable(
  'visibility_grants',
  {
    id: id(),
    orgId: orgId(),
    userId: uuid('user_id').notNull(),
    resourceTable: text('resource_table').notNull(),
    resourceId: uuid('resource_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('visibility_grants_uq').on(
      t.userId,
      t.resourceTable,
      t.resourceId,
    ),
    index('visibility_grants_lookup').on(t.resourceTable, t.resourceId),
  ],
);

/* --------------------------------------------------------------- sending */

export const domains = pgTable(
  'domains',
  {
    id: id(),
    orgId: orgId(),
    domain: text('domain').notNull(),
    // primary domains are isolated from cold outreach (§5 deliverability)
    isPrimary: boolean('is_primary').notNull().default(false),
    dmarcPolicy: text('dmarc_policy'),
    healthScore: real('health_score').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('domains_org_domain_uq').on(t.orgId, t.domain)],
);

export const mailboxes = pgTable(
  'mailboxes',
  {
    id: id(),
    orgId: orgId(),
    userId: uuid('user_id').notNull(),
    domainId: uuid('domain_id'),
    email: text('email').notNull(),
    /** Reference into the secrets manager. Never the token itself (§3.1). */
    oauthTokenRef: text('oauth_token_ref'),
    // warming | ramping | steady | paused
    warmupStage: text('warmup_stage').notNull().default('warming'),
    warmupStartedAt: timestamp('warmup_started_at', { withTimezone: true }),
    dailyCap: integer('daily_cap').notNull().default(10),
    health: real('health').notNull().default(1),
    // active | paused | disabled
    status: text('status').notNull().default('active'),
    lastScannedAt: timestamp('last_scanned_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('mailboxes_org_email_uq').on(t.orgId, t.email)],
);

/* ------------------------------------------------------------------- CRM */

export const accounts = pgTable('accounts', {
  id: id(),
  orgId: orgId(),
  name: text('name').notNull(),
  domain: text('domain'),
  // prospect | customer | partner
  relationship: text('relationship').notNull().default('prospect'),
  industry: text('industry'),
  employeeCount: integer('employee_count'),
  techStack: jsonb('tech_stack').$type<string[]>().default(sql`'[]'::jsonb`),
  createdAt: createdAt(),
});

export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    orgId: orgId(),
    accountId: uuid('account_id'),
    fullName: text('full_name').notNull(),
    title: text('title'),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    phone: text('phone'),
    linkedinUrl: text('linkedin_url'),
    language: text('language').notNull().default('en'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('contacts_org_email_uq').on(t.orgId, t.email)],
);

/** One row per channel identity (email / whatsapp / linkedin). */
export const contactIdentities = pgTable(
  'contact_identities',
  {
    id: id(),
    orgId: orgId(),
    contactId: uuid('contact_id').notNull(),
    channel: text('channel').notNull(),
    identity: text('identity').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('contact_identities_uq').on(t.orgId, t.channel, t.identity),
  ],
);

export const funnels = pgTable('funnels', {
  id: id(),
  orgId: orgId(),
  name: text('name').notNull(),
  stages: jsonb('stages')
    .$type<{ key: string; label: string; order: number }[]>()
    .notNull(),
  rules: jsonb('rules').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const leads = pgTable(
  'leads',
  {
    id: id(),
    orgId: orgId(),
    contactId: uuid('contact_id').notNull(),
    accountId: uuid('account_id'),
    funnelId: uuid('funnel_id'),
    assignedUserId: uuid('assigned_user_id'),
    stage: text('stage').notNull().default('new'),
    score: real('score').notNull().default(0),
    intent: text('intent'),
    closeProbability: real('close_probability'),
    language: text('language').notNull().default('en'),
    optIn: boolean('opt_in').notNull().default(false),
    /** Trigger that justifies the first touch (§5 personalization). */
    signal: jsonb('signal').$type<{
      kind: string;
      summary: string;
      sourceUrl?: string;
    } | null>(),
    source: text('source'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('leads_org_contact_uq').on(t.orgId, t.contactId),
    index('leads_org_stage_idx').on(t.orgId, t.stage),
    index('leads_assigned_idx').on(t.assignedUserId),
  ],
);

export const leadTags = pgTable(
  'lead_tags',
  {
    orgId: orgId(),
    leadId: uuid('lead_id').notNull(),
    tag: text('tag').notNull(),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.tag] })],
);

/* -------------------------------------------------------------- messaging */

export const messages = pgTable(
  'messages',
  {
    id: id(),
    orgId: orgId(),
    leadId: uuid('lead_id').notNull(),
    mailboxId: uuid('mailbox_id'),
    assignedUserId: uuid('assigned_user_id'),
    channel: text('channel').notNull().default('email'),
    direction: text('direction').notNull(), // outbound | inbound
    threadId: text('thread_id'),
    providerMessageId: text('provider_message_id'),
    subject: text('subject'),
    body: text('body').notNull(),
    // draft | pending_approval | queued | sent | failed | received
    status: text('status').notNull().default('draft'),
    /** Idempotency key: lead + campaign + step (§3.6). */
    dedupeKey: text('dedupe_key'),
    sequenceStep: integer('sequence_step').notNull().default(0),
    variantKey: text('variant_key'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('messages_dedupe_uq').on(t.orgId, t.dedupeKey),
    index('messages_lead_idx').on(t.orgId, t.leadId),
    index('messages_status_idx').on(t.orgId, t.status),
  ],
);

export const replies = pgTable(
  'replies',
  {
    id: id(),
    orgId: orgId(),
    leadId: uuid('lead_id').notNull(),
    messageId: uuid('message_id'),
    rawBody: text('raw_body').notNull(),
    // interested | not_interested | referral | out_of_office | unsubscribe | auto | other
    category: text('category'),
    sentiment: text('sentiment'),
    closeProbability: real('close_probability'),
    /** Suggested reply. Never sent without human approval pre-gate (§10). */
    draft: text('draft'),
    draftApprovedBy: uuid('draft_approved_by'),
    handled: boolean('handled').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('replies_lead_idx').on(t.orgId, t.leadId)],
);

export const followUps = pgTable(
  'follow_ups',
  {
    id: id(),
    orgId: orgId(),
    leadId: uuid('lead_id').notNull(),
    step: integer('step').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    // pending | cancelled | done
    status: text('status').notNull().default('pending'),
    cancelledReason: text('cancelled_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('follow_ups_uq').on(t.orgId, t.leadId, t.step),
    index('follow_ups_due_idx').on(t.status, t.dueAt),
  ],
);

/* ------------------------------------------------------------- compliance */

export const suppression = pgTable(
  'suppression',
  {
    id: id(),
    orgId: orgId(),
    /** Lowercased email, or `@domain` for a whole-domain block. */
    value: text('value').notNull(),
    // unsubscribe | customer | open_deal | bounce | manual | complaint
    reason: text('reason').notNull(),
    note: text('note'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('suppression_org_value_uq').on(t.orgId, t.value)],
);

/** Anti-resend ledger, fed by continuous scans of every mailbox (§5). */
export const contactedRegistry = pgTable(
  'contacted_registry',
  {
    id: id(),
    orgId: orgId(),
    email: text('email').notNull(),
    firstContactedAt: timestamp('first_contacted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    byMailboxId: uuid('by_mailbox_id'),
    source: text('source').notNull().default('engine'),
    timesContacted: integer('times_contacted').notNull().default(1),
  },
  (t) => [uniqueIndex('contacted_registry_org_email_uq').on(t.orgId, t.email)],
);

export const consentLog = pgTable('consent_log', {
  id: id(),
  orgId: orgId(),
  contactId: uuid('contact_id'),
  email: text('email').notNull(),
  channel: text('channel').notNull().default('email'),
  action: text('action').notNull(), // opt_in | opt_out
  evidence: text('evidence'),
  createdAt: createdAt(),
});

export const dsrRequests = pgTable('dsr_requests', {
  id: id(),
  orgId: orgId(),
  subjectEmail: text('subject_email').notNull(),
  kind: text('kind').notNull(), // export | delete
  status: text('status').notNull().default('pending'),
  requestedBy: uuid('requested_by'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/* -------------------------------------------------------- agents & ops */

export const agents = pgTable(
  'agents',
  {
    id: id(),
    orgId: orgId(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** Allow-list of MCP tool names this agent may call (§3.2). */
    allowedTools: jsonb('allowed_tools')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // suggest | autonomous — autonomous is refused until the gate passes
    mode: text('mode').notNull().default('suggest'),
    enabled: boolean('enabled').notNull().default(true),
    confidenceThreshold: real('confidence_threshold').notNull().default(0.8),
    dailyTokenBudget: integer('daily_token_budget').notNull().default(200000),
    dailyActionCap: integer('daily_action_cap').notNull().default(200),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('agents_org_key_uq').on(t.orgId, t.key)],
);

export const agentTraces = pgTable(
  'agent_traces',
  {
    id: id(),
    orgId: orgId(),
    agentKey: text('agent_key').notNull(),
    tool: text('tool'),
    input: jsonb('input').$type<Record<string, unknown>>(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    confidence: real('confidence'),
    // proposed | approved | rejected | executed | blocked | error
    outcome: text('outcome').notNull(),
    blockedReason: text('blocked_reason'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('agent_traces_org_agent_idx').on(t.orgId, t.agentKey, t.createdAt)],
);

/** Durable job queue (replaces BullMQ on serverless; §3.6). */
export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    orgId: orgId(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** Unique per logical unit of work — enforces at-most-once. */
    idempotencyKey: text('idempotency_key').notNull(),
    // pending | running | done | failed | dead
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('jobs_idempotency_uq').on(t.orgId, t.idempotencyKey),
    index('jobs_claim_idx').on(t.status, t.runAt),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    orgId: orgId(),
    actorUserId: uuid('actor_user_id'),
    actorKind: text('actor_kind').notNull().default('user'), // user | agent | system
    action: text('action').notNull(),
    resourceTable: text('resource_table'),
    resourceId: uuid('resource_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_org_idx').on(t.orgId, t.createdAt)],
);

export const outcomes = pgTable('outcomes', {
  id: id(),
  orgId: orgId(),
  leadId: uuid('lead_id').notNull(),
  kind: text('kind').notNull(), // replied | meeting | deal | lost
  value: real('value'),
  createdAt: createdAt(),
});

export const experiments = pgTable(
  'experiments',
  {
    id: id(),
    orgId: orgId(),
    key: text('key').notNull(),
    variants: jsonb('variants').$type<string[]>().notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('experiments_org_key_uq').on(t.orgId, t.key)],
);

export const experimentAssignments = pgTable(
  'experiment_assignments',
  {
    id: id(),
    orgId: orgId(),
    experimentKey: text('experiment_key').notNull(),
    leadId: uuid('lead_id').notNull(),
    variant: text('variant').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('experiment_assignments_uq').on(
      t.orgId,
      t.experimentKey,
      t.leadId,
    ),
  ],
);
