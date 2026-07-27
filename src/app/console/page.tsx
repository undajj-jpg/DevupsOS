import Link from 'next/link';
import {
  Badge,
  Card,
  Empty,
  Eyebrow,
  LiveDot,
  Meter,
  PageHeader,
  Stat,
} from '@/components/ui';
import { loadDashboard, requirePageSession } from '@/lib/server-data';
import { env } from '@/lib/env';
import { sortByStage, stageLabel } from '@/core/stages';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await requirePageSession();
  const data = await loadDashboard(session);
  const forceSuggestion = env().FORCE_SUGGESTION_MODE;

  const totalCapacity = data.mailboxes.reduce((n, m) => n + m.effectiveCap, 0);
  const stageTotal = data.byStage.reduce((n, s) => n + s.n, 0);

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <LiveDot />
            <Eyebrow>Fase 1 · núcleo</Eyebrow>
          </span>
        }
        title={data.org?.name ?? 'Panel'}
        lede="Sourcing hasta el primer contacto. Cada envío queda detenido esperando a una persona."
        actions={
          data.totals.pendingApproval > 0 ? (
            <Link
              href="/console/approvals"
              className="inline-flex items-center gap-2 rounded-lg border border-accent bg-accent px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-white transition-colors hover:bg-accent-ink"
            >
              Revisar {data.totals.pendingApproval}
            </Link>
          ) : null
        }
      />

      {/* The autonomy gate is the most consequential piece of state in the
          product, so it sits above everything rather than in a settings page. */}
      <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 px-5 py-4">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <div
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl font-mono text-[15px] ${
                data.org?.autonomyGatePassed
                  ? 'bg-ok-soft text-ok'
                  : 'bg-warn-soft text-warn'
              }`}
              aria-hidden
            >
              {data.org?.autonomyGatePassed ? '✓' : '⏸'}
            </div>
            <div className="min-w-0">
              <Eyebrow>Puerta de autonomía · §10</Eyebrow>
              <p className="mt-1 text-[15px] leading-snug text-ink">
                {data.org?.autonomyGatePassed
                  ? 'Superada. Los agentes pueden actuar dentro de sus límites.'
                  : 'No superada — los agentes proponen y una persona confirma.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data.org?.autonomyGatePassed ? (
              <Badge tone="ok" dot>
                Superada
              </Badge>
            ) : (
              <Badge tone="warn" dot>
                Modo sugerencia
              </Badge>
            )}
            {data.org?.agentsEnabled ? (
              <Badge tone="neutral">Agentes activos</Badge>
            ) : (
              <Badge tone="danger" dot>
                Kill switch
              </Badge>
            )}
            {forceSuggestion && <Badge tone="neutral">force_suggestion</Badge>}
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Leads" value={data.totals.leads} />
        <Stat
          label="Esperando aprobación"
          value={data.totals.pendingApproval}
          tone={data.totals.pendingApproval > 0 ? 'accent' : 'neutral'}
          hint={data.totals.pendingApproval > 0 ? 'Nada sale sin revisión' : undefined}
        />
        <Stat label="Respuestas" value={data.totals.replies} />
        <Stat
          label="Suprimidos"
          value={data.totals.suppressed}
          hint="Bloqueo previo al envío"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card
          title="Pipeline"
          description="Leads por etapa del embudo."
          className="lg:col-span-2"
          aside={<Eyebrow>{stageTotal} total</Eyebrow>}
        >
          {data.byStage.length === 0 ? (
            <Empty>
              Todavía no hay leads. Importá un lote desde la API para empezar.
            </Empty>
          ) : (
            <ul className="space-y-3.5">
              {sortByStage(data.byStage).map((row) => (
                <li key={row.stage}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="text-[15px] text-ink">
                      {stageLabel(row.stage)}
                    </span>
                    <span className="tabular font-mono text-[12px] text-muted">
                      {row.n}
                    </span>
                  </div>
                  <Meter value={row.n} max={Math.max(stageTotal, 1)} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Buzones"
          description="El cupo efectivo combina etapa de warmup, salud y dominio."
          className="lg:col-span-3"
          aside={
            <span className="tabular font-mono text-[12px] text-muted">
              {totalCapacity} envíos/día
            </span>
          }
        >
          {data.mailboxes.length === 0 ? (
            <Empty>
              Sin buzones conectados. El envío en frío queda desactivado hasta que
              haya al menos un buzón de dominio secundario en warmup.
            </Empty>
          ) : (
            <ul className="divide-y divide-line-soft">
              {data.mailboxes.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[13px] text-ink">
                      {m.email}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Badge
                        tone={m.warmupStage === 'steady' ? 'ok' : 'warn'}
                      >
                        {m.warmupStage}
                      </Badge>
                      <span className="font-mono text-[11px] text-muted">
                        salud {m.health.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="w-28 shrink-0">
                    <div className="tabular mb-1.5 text-right font-mono text-[12px] text-ink-soft">
                      {m.effectiveCap}/día
                    </div>
                    <Meter
                      value={m.effectiveCap}
                      max={Math.max(m.dailyCap, 1)}
                      tone={m.effectiveCap === 0 ? 'warn' : 'accent'}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
