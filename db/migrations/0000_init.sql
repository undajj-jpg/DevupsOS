CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"relationship" text DEFAULT 'prospect' NOT NULL,
	"industry" text,
	"employee_count" integer,
	"tech_stack" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_key" text NOT NULL,
	"tool" text,
	"input" jsonb,
	"output" jsonb,
	"confidence" real,
	"outcome" text NOT NULL,
	"blocked_reason" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mode" text DEFAULT 'suggest' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"confidence_threshold" real DEFAULT 0.8 NOT NULL,
	"daily_token_budget" integer DEFAULT 200000 NOT NULL,
	"daily_action_cap" integer DEFAULT 200 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"resource_table" text,
	"resource_id" uuid,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contact_id" uuid,
	"email" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"action" text NOT NULL,
	"evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"identity" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacted_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"first_contacted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_contacted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_mailbox_id" uuid,
	"source" text DEFAULT 'engine' NOT NULL,
	"times_contacted" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"account_id" uuid,
	"full_name" text NOT NULL,
	"title" text,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"phone" text,
	"linkedin_url" text,
	"language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"dmarc_policy" text,
	"health_score" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dsr_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"subject_email" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiment_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"experiment_key" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"variants" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"step" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cancelled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"stages" jsonb NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_tags" (
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "lead_tags_lead_id_tag_pk" PRIMARY KEY("lead_id","tag")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"account_id" uuid,
	"funnel_id" uuid,
	"assigned_user_id" uuid,
	"stage" text DEFAULT 'new' NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"intent" text,
	"close_probability" real,
	"language" text DEFAULT 'en' NOT NULL,
	"opt_in" boolean DEFAULT false NOT NULL,
	"signal" jsonb,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"domain_id" uuid,
	"email" text NOT NULL,
	"oauth_token_ref" text,
	"warmup_stage" text DEFAULT 'warming' NOT NULL,
	"warmup_started_at" timestamp with time zone,
	"daily_cap" integer DEFAULT 10 NOT NULL,
	"health" real DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"mailbox_id" uuid,
	"assigned_user_id" uuid,
	"channel" text DEFAULT 'email' NOT NULL,
	"direction" text NOT NULL,
	"thread_id" text,
	"provider_message_id" text,
	"subject" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"dedupe_key" text,
	"sequence_step" integer DEFAULT 0 NOT NULL,
	"variant_key" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"agents_enabled" boolean DEFAULT true NOT NULL,
	"autonomy_gate_passed" boolean DEFAULT false NOT NULL,
	"physical_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"message_id" uuid,
	"raw_body" text NOT NULL,
	"category" text,
	"sentiment" text,
	"close_probability" real,
	"draft" text,
	"draft_approved_by" uuid,
	"handled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"value" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visibility_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"resource_table" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_traces_org_agent_idx" ON "agent_traces" USING btree ("org_id","agent_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_org_key_uq" ON "agents" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "audit_log_org_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identities_uq" ON "contact_identities" USING btree ("org_id","channel","identity");--> statement-breakpoint
CREATE UNIQUE INDEX "contacted_registry_org_email_uq" ON "contacted_registry" USING btree ("org_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_email_uq" ON "contacts" USING btree ("org_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_org_domain_uq" ON "domains" USING btree ("org_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_assignments_uq" ON "experiment_assignments" USING btree ("org_id","experiment_key","lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "experiments_org_key_uq" ON "experiments" USING btree ("org_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_ups_uq" ON "follow_ups" USING btree ("org_id","lead_id","step");--> statement-breakpoint
CREATE INDEX "follow_ups_due_idx" ON "follow_ups" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_uq" ON "jobs" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_org_contact_uq" ON "leads" USING btree ("org_id","contact_id");--> statement-breakpoint
CREATE INDEX "leads_org_stage_idx" ON "leads" USING btree ("org_id","stage");--> statement-breakpoint
CREATE INDEX "leads_assigned_idx" ON "leads" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_org_email_uq" ON "mailboxes" USING btree ("org_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_dedupe_uq" ON "messages" USING btree ("org_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "messages_lead_idx" ON "messages" USING btree ("org_id","lead_id");--> statement-breakpoint
CREATE INDEX "messages_status_idx" ON "messages" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "replies_lead_idx" ON "replies" USING btree ("org_id","lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_org_value_uq" ON "suppression" USING btree ("org_id","value");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "visibility_grants_uq" ON "visibility_grants" USING btree ("user_id","resource_table","resource_id");--> statement-breakpoint
CREATE INDEX "visibility_grants_lookup" ON "visibility_grants" USING btree ("resource_table","resource_id");