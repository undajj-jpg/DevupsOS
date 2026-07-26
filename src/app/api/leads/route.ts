import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { accounts, contacts, leads } from '@/db/schema';
import { authenticated } from '@/lib/http';
import { audit } from '@/lib/audit';
import { isValidEmail, normalizeEmail } from '@/core/email';
import { scoreLead } from '@/core/scoring';
import { currentSession } from '@/lib/auth/session';
import { withOrgContext } from '@/db/client';
import { handleError, jsonError } from '@/lib/http';

export const runtime = 'nodejs';

const importSchema = z.object({
  source: z.string().max(60).default('manual'),
  leads: z
    .array(
      z.object({
        email: z.string().max(254),
        fullName: z.string().min(1).max(160),
        title: z.string().max(160).nullable().optional(),
        companyName: z.string().min(1).max(160),
        companyDomain: z.string().max(160).nullable().optional(),
        employeeCount: z.number().int().min(0).max(5_000_000).nullable().optional(),
        techStack: z.array(z.string().max(60)).max(50).default([]),
        language: z.enum(['en', 'es', 'pt']).default('en'),
        emailVerified: z.boolean().default(false),
        signal: z
          .object({
            kind: z.enum([
              'job_posting',
              'tech_stack',
              'funding',
              'expansion',
              'other',
            ]),
            summary: z.string().max(1000),
            sourceUrl: z.string().url().optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .min(1)
    .max(500),
});

export async function GET() {
  try {
    const session = await currentSession();
    if (!session) return jsonError(401, 'authentication required', 'unauthorized');

    const rows = await withOrgContext(
      { orgId: session.orgId, userId: session.userId, role: session.role },
      async (tx) =>
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
            emailVerified: contacts.emailVerified,
            company: accounts.name,
            createdAt: leads.createdAt,
          })
          .from(leads)
          .innerJoin(contacts, eq(contacts.id, leads.contactId))
          .leftJoin(accounts, eq(accounts.id, leads.accountId))
          .where(eq(leads.orgId, session.orgId))
          .orderBy(desc(leads.score), desc(leads.createdAt))
          .limit(200),
    );

    return Response.json({ data: rows });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Bulk import (MCP `import_leads`). Rejects unverified-looking addresses up
 * front and deduplicates against existing contacts by (org, email), so
 * re-running the same import is a no-op rather than a source of duplicates.
 */
export const POST = authenticated(importSchema, async ({ body, session, tx }) => {
  const accepted: string[] = [];
  const rejected: { email: string; reason: string }[] = [];

  const seen = new Set<string>();
  const normalized = body.leads.flatMap((lead) => {
    const email = normalizeEmail(lead.email);
    if (!isValidEmail(email)) {
      rejected.push({ email: lead.email, reason: 'invalid address' });
      return [];
    }
    if (seen.has(email)) {
      rejected.push({ email, reason: 'duplicate within payload' });
      return [];
    }
    seen.add(email);
    return [{ ...lead, email }];
  });

  if (normalized.length === 0) {
    return { imported: 0, accepted, rejected };
  }

  const existing = await tx
    .select({ email: contacts.email, id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.orgId, session.orgId),
        inArray(
          contacts.email,
          normalized.map((l) => l.email),
        ),
      ),
    );
  const existingByEmail = new Map(existing.map((c) => [c.email, c.id]));

  for (const lead of normalized) {
    let contactId = existingByEmail.get(lead.email);

    if (!contactId) {
      const [account] = await tx
        .insert(accounts)
        .values({
          orgId: session.orgId,
          name: lead.companyName,
          domain: lead.companyDomain ?? null,
          employeeCount: lead.employeeCount ?? null,
          techStack: lead.techStack,
        })
        .returning({ id: accounts.id });

      const [contact] = await tx
        .insert(contacts)
        .values({
          orgId: session.orgId,
          accountId: account?.id ?? null,
          fullName: lead.fullName,
          title: lead.title ?? null,
          email: lead.email,
          emailVerified: lead.emailVerified,
          language: lead.language,
        })
        .onConflictDoNothing({ target: [contacts.orgId, contacts.email] })
        .returning({ id: contacts.id });

      contactId = contact?.id;
      if (!contactId) {
        rejected.push({ email: lead.email, reason: 'contact insert conflicted' });
        continue;
      }

      await tx
        .insert(leads)
        .values({
          orgId: session.orgId,
          contactId,
          accountId: account?.id ?? null,
          stage: 'new',
          language: lead.language,
          signal: lead.signal ?? null,
          source: body.source,
          score: scoreLead({
            hasSignal: Boolean(lead.signal),
            emailVerified: lead.emailVerified,
            title: lead.title ?? null,
            employeeCount: lead.employeeCount ?? null,
            techStack: lead.techStack,
            language: lead.language,
          }),
        })
        .onConflictDoNothing({ target: [leads.orgId, leads.contactId] });

      accepted.push(lead.email);
    } else {
      rejected.push({ email: lead.email, reason: 'already in CRM' });
    }
  }

  await audit(tx, {
    orgId: session.orgId,
    actorUserId: session.userId,
    action: 'leads.import',
    meta: { source: body.source, accepted: accepted.length, rejected: rejected.length },
  });

  return { imported: accepted.length, accepted, rejected };
});
