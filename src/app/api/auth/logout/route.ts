import { clearSessionCookie } from '@/lib/auth/session';
import { handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST() {
  try {
    await clearSessionCookie();
    return ok({ signedOut: true });
  } catch (err) {
    return handleError(err);
  }
}
