'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Eyebrow } from '@/components/ui';

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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>, tag: string) {
    setBusy(tag);
    setError(null);
    const res = await fetch('/api/agents', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      setError(payload?.error?.message ?? 'No se pudo actualizar');
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div
        className={`rounded-xl border p-5 ${
          globalEnabled ? 'border-line bg-raised' : 'border-danger/30 bg-danger-soft'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 max-w-lg">
            <Eyebrow>Kill switch global · §3.5</Eyebrow>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">
              Con el switch activado ningún agente actúa. <code className="font-mono text-[13px] text-accent-ink">pause</code>{' '}
              sigue disponible, porque detener la máquina tiene que funcionar
              incluso cuando la máquina está detenida.
            </p>
          </div>
          <Button
            variant={globalEnabled ? 'danger' : 'ok'}
            disabled={!canEdit || busy !== null}
            onClick={() => patch({ globalEnabled: !globalEnabled }, 'global')}
          >
            {busy === 'global'
              ? '…'
              : globalEnabled
                ? 'Detener todo'
                : 'Reactivar'}
          </Button>
        </div>
      </div>

      {!gatePassed && (
        <div className="rounded-xl border border-warn/30 bg-warn-soft px-5 py-4">
          <Eyebrow className="text-warn">Puerta cerrada</Eyebrow>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">
            La puerta de autonomía no fue superada, así que pasar un agente a
            autónomo se rechaza. Todos corren en modo sugerencia.
            {forceSuggestionMode &&
              ' Además FORCE_SUGGESTION_MODE está activo, lo que fija el modo sugerencia sin importar el estado en base de datos.'}
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger-soft px-5 py-3 font-mono text-[12px] text-danger">
          {error}
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {agents.map((agent) => (
          <li
            key={agent.key}
            className={`rounded-xl border p-4 ${
              agent.enabled ? 'border-line bg-raised' : 'border-line bg-canvas'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-[16px] leading-snug font-semibold text-ink">
                  {agent.name}
                </h3>
                <div className="mt-0.5 font-mono text-[10.5px] tracking-[0.1em] text-muted">
                  {agent.key}
                </div>
              </div>
              <Badge tone={agent.mode === 'autonomous' ? 'warn' : 'neutral'}>
                {agent.mode === 'autonomous' ? 'autónomo' : 'sugiere'}
              </Badge>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {agent.allowedTools.map((tool) => (
                <code
                  key={tool}
                  className="rounded-md border border-line-soft bg-canvas px-1.5 py-0.5 font-mono text-[10.5px] text-ink-soft"
                >
                  {tool}
                </code>
              ))}
              {agent.allowedTools.length === 0 && (
                <span className="font-mono text-[10.5px] text-muted">
                  sin herramientas
                </span>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-line-soft pt-3">
              {agent.enabled ? (
                <Badge tone="ok" dot>
                  activo
                </Badge>
              ) : (
                <Badge tone="danger" dot>
                  detenido
                </Badge>
              )}
              <Button
                variant="ghost"
                disabled={!canEdit || busy !== null}
                onClick={() =>
                  patch(
                    { agent: { key: agent.key, enabled: !agent.enabled } },
                    agent.key,
                  )
                }
              >
                {busy === agent.key ? '…' : agent.enabled ? 'Detener' : 'Activar'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
