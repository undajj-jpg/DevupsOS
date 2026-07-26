import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { verifyPassword } from '@/lib/auth/password';
import { setSessionCookie } from '@/lib/auth/session';
import { clientIp, handleError, jsonError, ok } from '@/lib/http';
import { LIMITS, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  try {
    // Throttle by address and by source: neither a password-spray across many
    // accounts nor a brute force against one should get many attempts.
    const parsedBody = schema.safeParse(await req.json().catch(() => null));
    const byIp = await rateLimit('login_ip', clientIp(req), LIMITS.login);
    if (!byIp.allowed) {
      return jsonError(429, 'too many attempts', 'rate_limited');
    }

    if (!parsedBody.success) {
      return jsonError(400, 'email and password are required', 'validation_failed');
    }
    const { email, password } = parsedBody.data;

    const byAccount = await rateLimit('login_account', email.toLowerCase(), LIMITS.login);
    if (!byAccount.allowed) {
      return jsonError(429, 'too many attempts', 'rate_limited');
    }

    const rows = await db().execute<{
      id: string;
      org_id: string;
      role: string;
      password_hash: string;
      active: boolean;
    }>(sql`SELECT * FROM app.lookup_login(${email})`);

    const user = rows[0];

    // Always run a verification, even with no user, so response timing does
    // not distinguish "unknown address" from "wrong password".
    const stored =
      user?.password_hash ??
      'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const valid = await verifyPassword(password, stored);

    if (!user || !valid || !user.active) {
      return jsonError(401, 'invalid credentials', 'unauthorized');
    }

    await setSessionCookie({
      orgId: user.org_id,
      userId: user.id,
      role: user.role,
      email: email.toLowerCase(),
    });

    return ok({ userId: user.id, orgId: user.org_id, role: user.role });
  } catch (err) {
    return handleError(err);
  }
}
