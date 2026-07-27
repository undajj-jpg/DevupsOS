import Link from 'next/link';
import { Empty, Eyebrow, PageHeader } from '@/components/ui';
import { loadBoard, requirePageSession } from '@/lib/server-data';
import { Board } from './board';

export const dynamic = 'force-dynamic';

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ funnel?: string }>;
}) {
  const session = await requirePageSession();
  const { funnel } = await searchParams;
  const board = await loadBoard(session, funnel);

  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>Pipeline · tablero</Eyebrow>}
        title={board.selected?.name ?? 'Embudo'}
        lede="Arrastrá una tarjeta para cambiar de etapa, o usá el selector. Cada movimiento queda auditado, y llegar a reunión, ganado o perdido registra el resultado para el reporte de conversión."
        actions={
          <span className="tabular font-mono text-[12px] text-muted">
            {board.total} leads
          </span>
        }
      />

      {board.funnels.length > 1 && (
        <nav className="flex flex-wrap items-center gap-2">
          {board.funnels.map((f) => (
            <Link
              key={f.id}
              href={`/console/pipeline?funnel=${f.id}`}
              aria-current={board.selected?.id === f.id ? 'page' : undefined}
              className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
                board.selected?.id === f.id
                  ? 'border-accent/30 bg-accent-soft text-accent-ink'
                  : 'border-line text-muted hover:bg-line-soft hover:text-ink'
              }`}
            >
              {f.name}
            </Link>
          ))}
        </nav>
      )}

      {board.total === 0 ? (
        <Empty>
          El embudo está vacío. Importá leads con POST /api/leads y aparecerán en
          la primera columna.
        </Empty>
      ) : (
        <Board columns={board.columns} stages={board.stages} />
      )}
    </>
  );
}
