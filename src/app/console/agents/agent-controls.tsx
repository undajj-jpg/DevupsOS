'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui';

export type AgentRow = {
  key: string;
  name: string;
  mode: string;
  enabled: boolean;
  allowedTools: string[];
};

export function AgentControls({
  canEdit,
  globalEnabled,
  gatePassed,
  forceSuggestionMode,
  agents,
}: {
  canEdit: boolean;
  globalEnabled: boolean;
  gatePassed: boolean;
  forceSuggestionMode: boolean;
  agents: AgentRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/agents', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      setError(payload?.error?.message ?? 'Update failed');
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[var(--color-line)] p-4 dark:border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Global kill switch</div>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              When engaged, every agent stops acting immediately. `pause` remains
              reachable so the machine can always be stopped.
            </p>
          </div>
          <button
            type="button"
            disabled={!canEdit || busy}
            onClick={() => patch({ globalEnabled: !globalEnabled })}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
              globalEnabled ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-ok)]'
            }`}
          >
            {globalEnabled ? 'Engage kill switch' : 'Release kill switch'}
          </button>
        </div>
      </div>

      {!gatePassed && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-[var(--color-warn)] dark:bg-amber-500/10">
          The autonomy gate has not been passed, so switching an agent to
          autonomous is refused. Every agent runs in suggestion mode.
          {forceSuggestionMode &&
            ' FORCE_SUGGESTION_MODE is also set, which pins suggestion mode regardless of database state.'}
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-[var(--color-danger)] dark:bg-red-500/10">
          {error}
        </p>
      )}

      <ul className="space-y-3">
        {agents.map((agent) => (
          <li
            key={agent.key}
            className="rounded-lg border border-[var(--color-line)] p-4 dark:border-white/10"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{agent.name}</span>
                  <Badge tone={agent.mode === 'autonomous' ? 'warn' : 'neutral'}>
                    {agent.mode}
                  </Badge>
                  {!agent.enabled && <Badge tone="danger">disabled</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {agent.allowedTools.map((tool) => (
                    <code
                      key={tool}
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-white/10"
                    >
                      {tool}
                    </code>
                  ))}
                </div>
              </div>
              <button
                type="button"
                disabled={!canEdit || busy}
                onClick={() =>
                  patch({ agent: { key: agent.key, enabled: !agent.enabled } })
                }
                className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/15"
              >
                {agent.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
