import { Card } from '@/components/ui';
import { loadAgents, requirePageSession } from '@/lib/server-data';
import { env } from '@/lib/env';
import { AgentControls } from './agent-controls';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const session = await requirePageSession();
  const { org, agents } = await loadAgents(session);

  return (
    <Card
      title="Agent operations"
      description="Kill switches, modes and tool allow-lists. Autonomy stays refused until the gate passes."
    >
      <AgentControls
        canEdit={session.role === 'owner' || session.role === 'admin'}
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
  );
}
