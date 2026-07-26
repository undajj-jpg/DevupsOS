import { authorizeCron, handleError, ok } from '@/lib/http';
import { runTick } from '@/lib/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Drains the job queue. Scheduled every 5 minutes by vercel.json. */
export async function GET(req: Request) {
  try {
    authorizeCron(req);
    return ok(await runTick());
  } catch (err) {
    return handleError(err);
  }
}
