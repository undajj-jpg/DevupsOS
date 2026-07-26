import { z } from 'zod';
import { authenticated } from '@/lib/http';
import { approveMessage } from '@/core/sendPipeline';

export const runtime = 'nodejs';

const schema = z.object({
  messageIds: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * The human checkpoint (spec §10). Approving a draft is the only path from
 * `pending_approval` to `queued`; no agent can perform this transition.
 */
export const POST = authenticated(schema, async ({ body, session, tx }) => {
  const results: { messageId: string; queued: boolean; reason?: string }[] = [];

  for (const messageId of body.messageIds) {
    const outcome = await approveMessage(tx, {
      orgId: session.orgId,
      userId: session.userId,
      messageId,
    });
    results.push({ messageId, ...outcome });
  }

  return {
    approved: results.filter((r) => r.queued).length,
    rejected: results.filter((r) => !r.queued),
  };
});
