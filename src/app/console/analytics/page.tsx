import {
  Badge,
  Card,
  Empty,
  Eyebrow,
  Meter,
  PageHeader,
  Row,
  Stat,
  Table,
} from '@/components/ui';
import { loadAnalytics, requirePageSession } from '@/lib/server-data';
import { formatPercent, formatUsd, MIN_SAMPLE } from '@/core/analytics';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const session = await requirePageSession();
  const data = await loadAnalytics(session);

  const top = data.totals.sent;

  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>Economía · §8</Eyebrow>}
        title="Conversión"
        lede="El embudo se cuenta sobre eventos, no sobre la etapa actual: un lead que respondió y después se enfrió sigue contando como respuesta. Es la medición que la Fase 2 espera antes de sumar capas."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Enviados"
          value={data.totals.sent}
          hint="Mensajes salientes en cola o enviados, de todas las campañas."
        />
        <Stat
          label="Tasa de respuesta"
          value={formatPercent(
            data.funnel.find((s) => s.key === 'replied')?.ofSent ?? null,
          )}
          tone="accent"
          hint="Leads distintos que contestaron, sobre el total enviado."
        />
        <Stat
          label="Reuniones"
          value={data.totals.meetings}
          hint="Registradas al llegar a la etapa, no al estar en ella hoy."
        />
        <Stat
          label="Costo por reunión"
          value={formatUsd(data.costPerMeeting)}
          hint="Solo gasto de modelo — sourcing y verificación los cobra un tercero que el motor todavía no llama."
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card
          title="Embudo"
          description="Cada paso contra el anterior y contra el total enviado."
          className="lg:col-span-3"
        >
          {top === 0 ? (
            <Empty>
              Todavía no salió ningún mensaje, así que no hay nada que medir.
            </Empty>
          ) : (
            <ul className="space-y-4">
              {data.funnel.map((step) => (
                <li key={step.key}>
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[15px] text-ink">{step.label}</span>
                    <span className="tabular font-mono text-[12px] text-muted">
                      {step.n}
                      {step.ofPrevious !== null && (
                        <>
                          {' · '}
                          <span className="text-accent">
                            {formatPercent(step.ofPrevious)}
                          </span>
                          {' del paso anterior'}
                        </>
                      )}
                    </span>
                  </div>
                  <Meter value={step.n} max={Math.max(top, 1)} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Gasto"
          description="Costo de modelo acumulado, de las trazas de agentes."
          className="lg:col-span-2"
        >
          <dl className="space-y-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[15px] text-ink">Total</dt>
              <dd className="tabular font-display text-[22px] font-semibold text-ink">
                {formatUsd(data.modelCostUsd)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[15px] text-ink-soft">Por reunión</dt>
              <dd className="tabular font-mono text-[13px] text-muted">
                {formatUsd(data.costPerMeeting)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[15px] text-ink-soft">Por cierre</dt>
              <dd className="tabular font-mono text-[13px] text-muted">
                {formatUsd(data.costPerDeal)}
              </dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-line-soft pt-3 text-[13px] leading-relaxed text-muted">
            No incluye Apollo, Anymail ni envío: son integraciones todavía no
            conectadas. Tratalo como piso, no como CAC.
          </p>
        </Card>
      </div>

      <Card
        title="Experimentos"
        description="Variante contra control, sobre tasa de respuesta."
        aside={
          <span className="font-mono text-[11px] text-muted">
            mínimo {MIN_SAMPLE}/brazo
          </span>
        }
      >
        {data.experiments.length === 0 ? (
          <Empty>
            Sin experimentos con asignaciones. El primer toque ya asigna variante
            por lead; los resultados aparecen cuando haya respuestas.
          </Empty>
        ) : (
          <div className="space-y-6">
            {data.experiments.map((experiment) => (
              <div key={experiment.key}>
                <Eyebrow>{experiment.key}</Eyebrow>
                <div className="mt-2">
                  <Table
                    head={['Variante', 'Asignados', 'Respuesta', 'Reunión', 'Lift']}
                  >
                    {experiment.variants.map((v) => (
                      <Row key={v.variant}>
                        <td className="py-3 pr-4">
                          <span className="font-mono text-[13px] text-ink">
                            {v.variant}
                          </span>
                          {v.liftPoints === null && (
                            <div className="mt-1">
                              <Badge tone="neutral">control</Badge>
                            </div>
                          )}
                        </td>
                        <td className="tabular py-3 pr-4 font-mono text-[13px] text-ink-soft">
                          {v.assigned}
                        </td>
                        <td className="tabular py-3 pr-4 font-mono text-[13px] text-ink">
                          {formatPercent(v.replyRate)}
                        </td>
                        <td className="tabular py-3 pr-4 font-mono text-[13px] text-ink-soft">
                          {formatPercent(v.meetingRate)}
                        </td>
                        <td className="py-3">
                          {v.liftPoints === null ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <span className="flex flex-wrap items-center gap-2">
                              <span
                                className={`tabular font-mono text-[13px] ${
                                  v.liftPoints >= 0 ? 'text-ok' : 'text-danger'
                                }`}
                              >
                                {v.liftPoints >= 0 ? '+' : ''}
                                {v.liftPoints.toFixed(1)} pts
                              </span>
                              {v.significant ? (
                                <Badge tone="ok">significativo</Badge>
                              ) : (
                                <Badge tone="neutral">ruido</Badge>
                              )}
                            </span>
                          )}
                        </td>
                      </Row>
                    ))}
                  </Table>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
