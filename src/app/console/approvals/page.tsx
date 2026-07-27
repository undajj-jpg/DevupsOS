import { Card, Empty, Eyebrow, PageHeader } from '@/components/ui';
import { loadPendingApprovals, requirePageSession } from '@/lib/server-data';
import { ApprovalList } from './approval-list';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const session = await requirePageSession();
  const drafts = await loadPendingApprovals(session);

  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>Human-in-the-loop · §10</Eyebrow>}
        title="Aprobaciones"
        lede="Aprobar es el único camino de borrador a cola. Ningún agente puede hacer esta transición, y nada de lo que ves acá fue enviado."
      />

      <Card
        title="Borradores pendientes"
        aside={
          <span className="tabular font-mono text-[12px] text-muted">
            {drafts.length}
          </span>
        }
      >
        {drafts.length === 0 ? (
          <Empty>
            No hay borradores pendientes. Generá un lote con POST /api/batch.
          </Empty>
        ) : (
          <ApprovalList
            drafts={drafts.map((d) => ({
              id: d.id,
              subject: d.subject ?? '(sin asunto)',
              body: d.body,
              variantKey: d.variantKey,
              contactEmail: d.contactEmail,
              contactName: d.contactName,
              company: d.company,
            }))}
          />
        )}
      </Card>
    </>
  );
}
