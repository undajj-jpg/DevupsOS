import { Badge, Card, Empty, Stat, Table } from '@/components/ui';
import { loadDashboard, requirePageSession } from '@/lib/server-data';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await requirePageSession();
  const data = await loadDashboard(session);
  const forceSuggestion = env().FORCE_SUGGESTION_MODE;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{data.org?.name ?? 'Dashboard'}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Phase 1 core: sourcing to first touch, with every send gated behind a
          human.
        </p>
      </div>

      {/* The autonomy gate is the most consequential piece of state in the
          product, so it is the first thing on the page rather than buried in
          settings. */}
      <div className="rounded-xl border border-[var(--color-line)] bg-white p-5 dark:border-white/10 dark:bg-white/5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">Autonomy gate</h2>
          {data.org?.autonomyGatePassed ? (
            <Badge tone="ok">Passed</Badge>
          ) : (
            <Badge tone="warn">Not passed — suggestion mode</Badge>
          )}
          {data.org?.agentsEnabled ? (
            <Badge tone="ok">Agents enabled</Badge>
          ) : (
            <Badge tone="danger">Kill switch engaged</Badge>
          )}
          {forceSuggestion && <Badge tone="warn">FORCE_SUGGESTION_MODE</Badge>}
        </div>
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          Until the gate passes, agents propose and a human confirms. No message
          leaves the system without an explicit approval.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Leads" value={data.totals.leads} />
        <Stat label="Awaiting approval" value={data.totals.pendingApproval} />
        <Stat label="Replies" value={data.totals.replies} />
        <Stat label="Suppressed" value={data.totals.suppressed} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Pipeline" description="Leads by funnel stage.">
          {data.byStage.length === 0 ? (
            <Empty>No leads yet. Import some to get started.</Empty>
          ) : (
            <Table head={['Stage', 'Leads']}>
              {data.byStage.map((row) => (
                <tr
                  key={row.stage}
                  className="border-b border-[var(--color-line)] last:border-0 dark:border-white/10"
                >
                  <td className="py-2">{row.stage}</td>
                  <td className="py-2 tabular-nums">{row.n}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card
          title="Mailboxes"
          description="Effective cap folds in warmup stage and health."
        >
          {data.mailboxes.length === 0 ? (
            <Empty>
              No mailboxes connected. Cold sending stays disabled until at least
              one secondary-domain mailbox is warmed.
            </Empty>
          ) : (
            <Table head={['Mailbox', 'Stage', 'Health', 'Effective cap']}>
              {data.mailboxes.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-[var(--color-line)] last:border-0 dark:border-white/10"
                >
                  <td className="py-2">{m.email}</td>
                  <td className="py-2">
                    <Badge tone={m.warmupStage === 'steady' ? 'ok' : 'warn'}>
                      {m.warmupStage}
                    </Badge>
                  </td>
                  <td className="py-2 tabular-nums">{m.health.toFixed(2)}</td>
                  <td className="py-2 tabular-nums">{m.effectiveCap}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
