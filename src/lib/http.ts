import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { currentSession, type Session } from '@/lib/auth/session';
import { withOrgContext, type Tx } from '@/db/client';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { env } from '@/lib/env';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
  ) {
    super(message);
  }
}

export function jsonError(status: number, message: string, code = 'error') {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

/** Constant-time comparison that tolerates differing lengths. */
export function secretEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so the reject path costs the same as a match.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) throw new HttpError(401, 'authentication required', 'unauthorized');
  return session;
}

export function requireRole(session: Session, roles: readonly string[]): void {
  if (!roles.includes(session.role)) {
    throw new HttpError(403, 'insufficient role', 'forbidden');
  }
}

/**
 * Wraps a route handler with auth, per-user rate limiting, body validation and
 * an RLS-scoped transaction. A handler reached through this never has to
 * remember to establish tenant context — and cannot accidentally skip it.
 */
export function authenticated<TBody>(
  // The explicit Input type parameter matters: `z.ZodType<TBody>` pins input
  // and output to the same shape, so a schema using `.default()` would infer
  // the pre-parse type (with optionals) instead of the parsed one.
  schema: z.ZodType<TBody, z.ZodTypeDef, unknown> | null,
  handler: (args: {
    body: TBody;
    session: Session;
    tx: Tx;
    req: Request;
  }) => Promise<unknown>,
) {
  return async (req: Request): Promise<NextResponse> => {
    try {
      const session = await requireSession();

      const limited = await rateLimit('api', session.userId, LIMITS.api);
      if (!limited.allowed) {
        return jsonError(429, 'rate limit exceeded', 'rate_limited');
      }

      let body = undefined as TBody;
      if (schema) {
        const json = await req.json().catch(() => {
          throw new HttpError(400, 'request body must be valid JSON', 'bad_json');
        });
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          throw new HttpError(
            400,
            parsed.error.issues
              .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
              .join('; '),
            'validation_failed',
          );
        }
        body = parsed.data;
      }

      const result = await withOrgContext(
        { orgId: session.orgId, userId: session.userId, role: session.role },
        (tx) => handler({ body, session, tx, req }),
      );

      return ok(result);
    } catch (err) {
      return handleError(err);
    }
  };
}

export function handleError(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return jsonError(err.status, err.message, err.code);
  }
  // Never leak internals: log server-side, return a generic message.
  console.error('[api] unhandled error', err);
  return jsonError(500, 'internal server error', 'internal_error');
}

/**
 * Authorizes a Vercel Cron invocation. Vercel signs cron requests with
 * CRON_SECRET as a bearer token; without it configured, the endpoint refuses
 * to run rather than defaulting to open.
 */
export function authorizeCron(req: Request): void {
  const secret = env().CRON_SECRET;
  if (!secret) {
    throw new HttpError(503, 'CRON_SECRET is not configured', 'not_configured');
  }
  const token = bearerToken(req);
  if (!token || !secretEquals(token, secret)) {
    throw new HttpError(401, 'invalid cron credentials', 'unauthorized');
  }
}
