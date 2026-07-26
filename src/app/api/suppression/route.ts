import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { suppression } from '@/db/schema';
import { authenticated } from '@/lib/http';
import { audit } from '@/lib/audit';
import { domainSuppressionKey, suppressionKey } from '@/core/suppression';
import { isValidEmail, normalizeEmail } from '@/core/email';

export const runtime = 'nodejs';

const schema = z.object({
  entries: z
    .array(
      z.object({
        value: z.string().min(3).max(254),
        /** `domain` blocks every address at that domain. */
        scope: z.enum(['address', 'domain']).default('address'),
        reason: z.enum([
          'unsubscribe',
          'customer',
          'open_deal',
          'bounce',
          'manual',
          'complaint',
        ]),
        note: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(1000),
});

export const GET = authenticated(null, async ({ session, tx }) =>
  tx
    .select({
      id: suppression.id,
      value: suppression.value,
      reason: suppression.reason,
      note: suppression.note,
      createdAt: suppression.createdAt,
    })
    .from(suppression)
    .where(eq(suppression.orgId, session.orgId))
    .orderBy(desc(suppression.createdAt))
    .limit(500),
);

export const POST = authenticated(schema, async ({ body, session, tx }) => {
  const added: string[] = [];
  const rejected: { value: string; reason: string }[] = [];

  for (const entry of body.entries) {
    const key =
      entry.scope === 'domain'
        ? domainSuppressionKey(entry.value)
        : suppressionKey(entry.value);

    if (entry.scope === 'address' && !isValidEmail(normalizeEmail(entry.value))) {
      rejected.push({ value: entry.value, reason: 'not a valid address' });
      continue;
    }

    await tx
      .insert(suppression)
      .values({
        orgId: session.orgId,
        value: key,
        reason: entry.reason,
        note: entry.note ?? null,
        createdBy: session.userId,
      })
      // Re-suppressing an address is idempotent, not an error.
      .onConflictDoNothing({ target: [suppression.orgId, suppression.value] });

    added.push(key);
  }

  await audit(tx, {
    orgId: session.orgId,
    actorUserId: session.userId,
    action: 'suppression.add',
    meta: { added: added.length, rejected: rejected.length },
  });

  return { added, rejected };
});
