import { Badge, Card, Empty, Table } from '@/components/ui';
import { loadLeads, requirePageSession } from '@/lib/server-data';

export const dynamic = 'force-dynamic';

export default async function LeadsPage() {
  const session = await requirePageSession();
  const rows = await loadLeads(session);

  return (
    <Card
      title="Leads"
      description="Ranked by ICP score. A signal is what makes the first touch specific."
    >
      {rows.length === 0 ? (
        <Empty>No leads yet. POST to /api/leads to import a batch.</Empty>
      ) : (
        <Table head={['Contact', 'Company', 'Stage', 'Score', 'Signal']}>
          {rows.map((lead) => (
            <tr
              key={lead.id}
              className="border-b border-[var(--color-line)] align-top last:border-0 dark:border-white/10"
            >
              <td className="py-3">
                <div className="font-medium">{lead.fullName}</div>
                <div className="text-xs text-[var(--color-muted)]">
                  {lead.email}
                  {!lead.verified && (
                    <span className="ml-2">
                      <Badge tone="warn">unverified</Badge>
                    </span>
                  )}
                </div>
              </td>
              <td className="py-3">{lead.company ?? '—'}</td>
              <td className="py-3">
                <Badge>{lead.stage}</Badge>
              </td>
              <td className="py-3 tabular-nums">{Math.round(lead.score)}</td>
              <td className="max-w-xs py-3 text-xs text-[var(--color-muted)]">
                {lead.signal?.summary ?? <em>generic opener</em>}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
