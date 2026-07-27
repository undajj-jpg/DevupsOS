import { and, count, desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import {
  accounts,
  agents,
  contacts,
  leads,
  mailboxes,
  messages,
  orgs,
  replies,
  suppression,
} from '@/db/schema';
import { withOrgContext } from '@/db/client';
import { currentSession, type Session } from '@/lib/auth/session';
import { effectiveDailyCap, type Mailbox, type WarmupStage } from '@/core/mailbox';
import { analyticsFor, boardFor } from '@/lib/reporting';

/**
 * Read helpers for server components. Each opens an RLS-scoped transaction, so
 * a page cannot render data the signed-in user is not entitled to see even if
 * the query itself forgets a filter.
 */

export async function requirePageSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect('/login');
  return session;
}

function ctx(session: Session) {
  return { orgId: session.orgId, userId: session.userId, role: session.role };
}

export async function loadDashboard(session: Session) {
  return withOrgContext(ctx(session), async (tx) => {
    const [org] = await tx
      .select({
        name: orgs.name,
        agentsEnabled: orgs.agentsEnabled,
        autonomyGatePassed: orgs.autonomyGatePassed,
      })
      .from(orgs)
      .where(eq(orgs.id, session.orgId))
      .limit(1);

    const [leadTotal] = await tx
      .select({ n: count() })
      .from(leads)
      .where(eq(leads.orgId, session.orgId));

    const [pending] = await tx
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.orgId, session.orgId),
          eq(messages.status, 'pending_approval'),
        ),
      );

    const [replyTotal] = await tx
      .select({ n: count() })
      .from(replies)
      .where(eq(replies.orgId, session.orgId));

    const [suppressedTotal] = await tx
      .select({ n: count() })
      .from(suppression)
      .where(eq(suppression.orgId, session.orgId));

    const byStage = await tx
      .select({ stage: leads.stage, n: count() })
      .from(leads)
      .where(eq(leads.orgId, session.orgId))
      .groupBy(leads.stage);

    const mailboxRows = await tx
      .select({
        id: mailboxes.id,
        email: mailboxes.email,
        warmupStage: mailboxes.warmupStage,
        warmupStartedAt: mailboxes.warmupStartedAt,
        dailyCap: mailboxes.dailyCap,
        health: mailboxes.health,
        status: mailboxes.status,
      })
      .from(mailboxes)
      .where(eq(mailboxes.orgId, session.orgId));

    const mailboxList = mailboxRows.map((m) => {
      const mailbox: Mailbox = {
        id: m.id,
        email: m.email,
        warmupStage: m.warmupStage as WarmupStage,
        warmupStartedAt: m.warmupStartedAt,
        dailyCap: m.dailyCap,
        health: m.health,
        status: m.status as Mailbox['status'],
        sentToday: 0,
        isPrimaryDomain: false,
      };
      return { ...m, effectiveCap: effectiveDailyCap(mailbox) };
    });

    return {
      org: org ?? null,
      totals: {
        leads: leadTotal?.n ?? 0,
        pendingApproval: pending?.n ?? 0,
        replies: replyTotal?.n ?? 0,
        suppressed: suppressedTotal?.n ?? 0,
      },
      byStage,
      mailboxes: mailboxList,
    };
  });
}

export async function loadLeads(session: Session) {
  return withOrgContext(ctx(session), (tx) =>
    tx
      .select({
        id: leads.id,
        stage: leads.stage,
        score: leads.score,
        language: leads.language,
        signal: leads.signal,
        email: contacts.email,
        fullName: contacts.fullName,
        title: contacts.title,
        verified: contacts.emailVerified,
        company: accounts.name,
      })
      .from(leads)
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .leftJoin(accounts, eq(accounts.id, leads.accountId))
      .where(eq(leads.orgId, session.orgId))
      .orderBy(desc(leads.score))
      .limit(100),
  );
}

export async function loadPendingApprovals(session: Session) {
  return withOrgContext(ctx(session), (tx) =>
    tx
      .select({
        id: messages.id,
        subject: messages.subject,
        body: messages.body,
        variantKey: messages.variantKey,
        createdAt: messages.createdAt,
        contactEmail: contacts.email,
        contactName: contacts.fullName,
        company: accounts.name,
      })
      .from(messages)
      .innerJoin(leads, eq(leads.id, messages.leadId))
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .leftJoin(accounts, eq(accounts.id, leads.accountId))
      .where(
        and(
          eq(messages.orgId, session.orgId),
          eq(messages.status, 'pending_approval'),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(100),
  );
}

export async function loadReplies(session: Session) {
  return withOrgContext(ctx(session), (tx) =>
    tx
      .select({
        id: replies.id,
        category: replies.category,
        sentiment: replies.sentiment,
        closeProbability: replies.closeProbability,
        handled: replies.handled,
        createdAt: replies.createdAt,
        body: replies.rawBody,
        contactEmail: contacts.email,
        contactName: contacts.fullName,
      })
      .from(replies)
      .innerJoin(leads, eq(leads.id, replies.leadId))
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .where(eq(replies.orgId, session.orgId))
      .orderBy(desc(replies.createdAt))
      .limit(100),
  );
}

/** Kanban board for one funnel (plataforma-completa §12). */
export async function loadBoard(session: Session, funnelId?: string) {
  return withOrgContext(ctx(session), (tx) =>
    boardFor(tx, session.orgId, funnelId),
  );
}

/** Conversion economics (master spec §8; plataforma-completa §25). */
export async function loadAnalytics(session: Session) {
  return withOrgContext(ctx(session), (tx) => analyticsFor(tx, session.orgId));
}

export async function loadAgents(session: Session) {
  return withOrgContext(ctx(session), async (tx) => {
    const [org] = await tx
      .select({
        agentsEnabled: orgs.agentsEnabled,
        autonomyGatePassed: orgs.autonomyGatePassed,
      })
      .from(orgs)
      .where(eq(orgs.id, session.orgId))
      .limit(1);

    const rows = await tx
      .select({
        key: agents.key,
        name: agents.name,
        mode: agents.mode,
        enabled: agents.enabled,
        allowedTools: agents.allowedTools,
      })
      .from(agents)
      .where(eq(agents.orgId, session.orgId))
      .orderBy(agents.key);

    return { org: org ?? null, agents: rows };
  });
}
