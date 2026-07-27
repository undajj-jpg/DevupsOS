import { Card, Eyebrow, PageHeader } from '@/components/ui';
import { loadAgents, requirePageSession } from '@/lib/server-data';
import { env } from '@/lib/env';
import { AgentControls } from './agent-controls';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const session = await requirePageSession();
  const { org, agents } = await loadAgents(session);
  const canEdit = session.role === 'owner' || session.role === 'admin';

  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>Agent-ops · gobierno</Eyebrow>}
        title="Agentes"
        lede="Kill switches, modos y allow-list de herramientas. La autonomía queda rechazada hasta que se supere la puerta del §10."
        actions={
          !canEdit ? (
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
              solo lectura
            </span>
          ) : null
        }
      />

      <Card
        title={`Roster · ${agents.length} agentes`}
        description="Cada agente arranca en modo sugerencia con la lista de herramientas más angosta que le permita hacer su trabajo."
      >
        <AgentControls
          canEdit={canEdit}
          globalEnabled={org?.agentsEnabled ?? false}
          gatePassed={org?.autonomyGatePassed ?? false}
          forceSuggestionMode={env().FORCE_SUGGESTION_MODE}
          agents={agents.map((a) => ({
            key: a.key,
            name: a.name,
            mode: a.mode,
            enabled: a.enabled,
            allowedTools: a.allowedTools,
          }))}
        />
      </Card>
    </>
  );
}
