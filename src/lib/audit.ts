import { auditLog, agentTraces } from '@/db/schema';
import type { Tx } from '@/db/client';

/** Append-only audit trail (spec §3.4). */
export async function audit(
  tx: Tx,
  entry: {
    orgId: string;
    actorUserId?: string | null;
    actorKind?: 'user' | 'agent' | 'system';
    action: string;
    resourceTable?: string;
    resourceId?: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    orgId: entry.orgId,
    actorUserId: entry.actorUserId ?? null,
    actorKind: entry.actorKind ?? 'user',
    action: entry.action,
    resourceTable: entry.resourceTable ?? null,
    resourceId: entry.resourceId ?? null,
    meta: entry.meta ?? null,
  });
}

/** Agent trace (spec §3.5) — every proposal and every block is recorded. */
export async function trace(
  tx: Tx,
  entry: {
    orgId: string;
    agentKey: string;
    tool?: string;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    confidence?: number;
    outcome: 'proposed' | 'approved' | 'rejected' | 'executed' | 'blocked' | 'error';
    blockedReason?: string;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  },
): Promise<void> {
  await tx.insert(agentTraces).values({
    orgId: entry.orgId,
    agentKey: entry.agentKey,
    tool: entry.tool ?? null,
    input: entry.input ?? null,
    output: entry.output ?? null,
    confidence: entry.confidence ?? null,
    outcome: entry.outcome,
    blockedReason: entry.blockedReason ?? null,
    inputTokens: entry.inputTokens ?? 0,
    outputTokens: entry.outputTokens ?? 0,
    costUsd: entry.costUsd ?? 0,
  });
}
