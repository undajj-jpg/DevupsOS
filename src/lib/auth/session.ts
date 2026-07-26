import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import type { OrgContext } from '@/db/client';

const COOKIE = 'devups_session';
const ISSUER = 'devups-growth-os';
const MAX_AGE_SECONDS = 60 * 60 * 12;

export type Session = OrgContext & { email: string };

function key(): Uint8Array {
  return new TextEncoder().encode(env().SESSION_SECRET);
}

export async function createSessionToken(session: Session): Promise<string> {
  return new SignJWT({
    orgId: session.orgId,
    userId: session.userId,
    role: session.role,
    email: session.email,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(key());
}

export async function readSessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, key(), {
      issuer: ISSUER,
      audience: ISSUER,
    });
    const { orgId, userId, role, email } = payload as Record<string, unknown>;
    if (
      typeof orgId !== 'string' ||
      typeof userId !== 'string' ||
      typeof role !== 'string' ||
      typeof email !== 'string'
    ) {
      return null;
    }
    return { orgId, userId, role, email };
  } catch {
    return null;
  }
}

export async function setSessionCookie(session: Session): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, await createSessionToken(session), {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function currentSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  return readSessionToken(token);
}

export const SESSION_COOKIE_NAME = COOKIE;
