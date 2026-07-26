import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, withOrgContext } from '@/db/client';
import { hashPassword } from '@/lib/auth/password';
import { setSessionCookie } from '@/lib/auth/session';
import { handleError, HttpError, ok, clientIp, jsonError } from '@/lib/http';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { seedOrgDefaults } from '@/core/bootstrap';

export const runtime = 'nodejs';

const schema = z.object({
  orgName: z.string().min(2).max(120),
  name: z.string().min(2).max(120),
  email: z.string().email().max(254),
  password: z.string().min(12).max(200),
});

export async function POST(req: Request) {
  try {
    const limited = await rateLimit('signup', clientIp(req), LIMITS.login);
    if (!limited.allowed) {
      return jsonError(429, 'too many attempts', 'rate_limited');
    }

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new HttpError(400, 'invalid signup payload', 'validation_failed');
    }
    const input = parsed.data;

    const passwordHash = await hashPassword(input.password);

    // Bootstrapping precedes any tenant context, so it goes through the
    // SECURITY DEFINER function rather than a direct insert (see 0001_rls.sql).
    const rows = await db().execute<{ org_id: string; user_id: string }>(sql`
      SELECT * FROM app.bootstrap_org(
        ${input.orgName}, ${input.email}, ${input.name}, ${passwordHash}
      )
    `);

    const row = rows[0];
    if (!row) throw new HttpError(500, 'failed to create organization');

    await withOrgContext(
      { orgId: row.org_id, userId: row.user_id, role: 'owner' },
      (tx) => seedOrgDefaults(tx, row.org_id, row.user_id),
    );

    await setSessionCookie({
      orgId: row.org_id,
      userId: row.user_id,
      role: 'owner',
      email: input.email.toLowerCase(),
    });

    return ok({ orgId: row.org_id, userId: row.user_id }, 201);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.toLowerCase().includes('already registered')
    ) {
      return jsonError(409, 'that email is already registered', 'conflict');
    }
    return handleError(err);
  }
}
