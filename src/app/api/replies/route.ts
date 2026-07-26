import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, leads, replies } from '@/db/schema';
import { authenticated } from '@/lib/http';
import { ingestReply } from '@/core/replyIntake';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = authenticated(null, async ({ session, tx }) =>
  tx
    .select({
      id: replies.id,
      leadId: replies.leadId,
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
    .limit(200),
);

const schema = z.object({
  leadId: z.string().uuid(),
  messageId: z.string().uuid().nullable().optional(),
  /** Raw inbound body. Treated as untrusted throughout (§3.2). */
  body: z.string().min(1).max(50_000),
});

export const POST = authenticated(schema, async ({ body, session, tx }) =>
  ingestReply(tx, {
    orgId: session.orgId,
    leadId: body.leadId,
    messageId: body.messageId ?? null,
    body: body.body,
  }),
);
