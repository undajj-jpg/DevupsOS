import { Badge, Card, Empty, Eyebrow, PageHeader, Row, Table } from '@/components/ui';
import { loadLeads, requirePageSession } from '@/lib/server-data';
import { stageLabel, stageTone } from '@/core/stages';

export const dynamic = 'force-dynamic';

const LANG: Record<string, string> = { en: 'EN', es: 'ES', pt: 'PT' };

const SIGNAL_ICON: Record<string, string> = {
  job_posting: '📋',
  tech_stack: '🧩',
  funding: '📈',
  expansion: '🌎',
  other: '•',
};

export default async function LeadsPage() {
  const session = await requirePageSession();
  const rows = await loadLeads(session);

  const withSignal = rows.filter((l) => l.signal).length;

  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>CRM · embudo outbound</Eyebrow>}
        title="Leads"
        lede="Ordenados por score ICP. La señal es lo que hace específico el primer contacto — sin señal, el mensaje cae al template genérico."
      />

      <Card
        title="Cartera"
        aside={
          <span className="font-mono text-[12px] text-muted">
            {withSignal}/{rows.length} con señal
          </span>
        }
      >
        {rows.length === 0 ? (
          <Empty>
            Todavía no hay leads. Hacé POST a /api/leads para importar un lote.
          </Empty>
        ) : (
          <Table head={['Contacto', 'Empresa', 'Etapa', 'Score', 'Señal']}>
            {rows.map((lead) => (
              <Row key={lead.id}>
                <td className="py-3.5 pr-4">
                  <div className="text-[15px] leading-snug text-ink">
                    {lead.fullName}
                  </div>
                  <div className="mt-0.5 font-mono text-[11.5px] text-muted">
                    {lead.email}
                  </div>
                  {!lead.verified && (
                    <div className="mt-1.5">
                      <Badge tone="warn">sin verificar</Badge>
                    </div>
                  )}
                </td>
                <td className="py-3.5 pr-4 text-[14px] text-ink-soft">
                  {lead.company ?? '—'}
                  {lead.title && (
                    <div className="mt-0.5 text-[13px] text-muted">{lead.title}</div>
                  )}
                </td>
                <td className="py-3.5 pr-4">
                  <Badge tone={stageTone(lead.stage)}>
                    {stageLabel(lead.stage)}
                  </Badge>
                  <div className="mt-1.5 font-mono text-[10.5px] tracking-[0.1em] text-muted">
                    {LANG[lead.language] ?? lead.language.toUpperCase()}
                  </div>
                </td>
                <td className="py-3.5 pr-4">
                  <span className="tabular font-display text-[19px] font-semibold text-ink">
                    {Math.round(lead.score)}
                  </span>
                </td>
                <td className="max-w-xs py-3.5 text-[13.5px] leading-snug text-ink-soft">
                  {lead.signal ? (
                    <span className="flex gap-2">
                      <span aria-hidden>
                        {SIGNAL_ICON[lead.signal.kind] ?? '•'}
                      </span>
                      <span>{lead.signal.summary}</span>
                    </span>
                  ) : (
                    <span className="text-muted italic">apertura genérica</span>
                  )}
                </td>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
