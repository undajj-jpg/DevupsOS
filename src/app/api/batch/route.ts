import { z } from 'zod';
import { authenticated, requireRole } from '@/lib/http';
import { prepareTodaysBatch } from '@/core/sendPipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

const schema = z.object({
  campaignKey: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_-]+$/, 'campaignKey must be lowercase alphanumeric'),
  limit: z.number().int().min(1).max(500).optional(),
});

/**
 * MCP `create_todays_batch` over HTTP. Produces drafts awaiting approval —
 * never sends. Restricted to owner/admin because it consumes mailbox capacity.
 */
export const POST = authenticated(schema, async ({ body, session, tx }) => {
  requireRole(session, ['owner', 'admin']);

  return prepareTodaysBatch(tx, {
    orgId: session.orgId,
    userId: session.userId,
    campaignKey: body.campaignKey,
    limit: body.limit,
  });
});
