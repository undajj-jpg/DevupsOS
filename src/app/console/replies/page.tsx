import { Badge, Card, Empty, Table } from '@/components/ui';
import { loadReplies, requirePageSession } from '@/lib/server-data';

export const dynamic = 'force-dynamic';

const TONE: Record<string, string> = {
  interested: 'ok',
  referral: 'ok',
  unsubscribe: 'danger',
  not_interested: 'warn',
};

export default async function RepliesPage() {
  const session = await requirePageSession();
  const rows = await loadReplies(session);

  return (
    <Card
      title="Replies"
      description="Classified on arrival. An opt-out suppresses the address and cuts the cadence before anything else runs."
    >
      {rows.length === 0 ? (
        <Empty>No replies yet.</Empty>
      ) : (
        <Table head={['Contact', 'Category', 'Close prob.', 'Message']}>
          {rows.map((reply) => (
            <tr
              key={reply.id}
              className="border-b border-[var(--color-line)] align-top last:border-0 dark:border-white/10"
            >
              <td className="py-3">
                <div className="font-medium">{reply.contactName}</div>
                <div className="text-xs text-[var(--color-muted)]">
                  {reply.contactEmail}
                </div>
              </td>
              <td className="py-3">
                <Badge tone={TONE[reply.category ?? ''] ?? 'neutral'}>
                  {reply.category ?? 'unclassified'}
                </Badge>
              </td>
              <td className="py-3 tabular-nums">
                {reply.closeProbability === null
                  ? '—'
                  : `${Math.round(reply.closeProbability * 100)}%`}
              </td>
              <td className="max-w-md py-3 text-xs text-[var(--color-muted)]">
                {reply.body.slice(0, 300)}
                {reply.body.length > 300 ? '…' : ''}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
