'use client';

import { useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Eyebrow } from '@/components/ui';
import { ENGINE_OWNED_STAGES, type BoardColumn } from '@/core/pipeline';
import { stageLabel } from '@/core/stages';

/**
 * The kanban board (plataforma-completa §12).
 *
 * Drag and drop is the asked-for interaction, but HTML5 drag events do not fire
 * on touch devices and are invisible to a keyboard. So every card also carries a
 * stage `<select>`: same endpoint, same validation, reachable by tab. The board
 * is not usable on a phone without it.
 */

export function Board({
  columns,
  stages,
}: {
  columns: BoardColumn[];
  stages: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stages the batch owns are shown so the funnel reads correctly, but nothing
  // can be dropped into them.
  const droppable = (key: string) =>
    !(ENGINE_OWNED_STAGES as readonly string[]).includes(key);

  async function move(leadId: string, stage: string) {
    setBusy(leadId);
    setError(null);

    const res = await fetch('/api/leads/stage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leadId, stage }),
    });

    setBusy(null);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'No se pudo mover el lead');
      return;
    }

    router.refresh();
  }

  function onDrop(event: DragEvent<HTMLDivElement>, stage: string) {
    event.preventDefault();
    setOver(null);
    const leadId = event.dataTransfer.getData('text/plain');
    setDragging(null);
    if (leadId && droppable(stage)) void move(leadId, stage);
  }

  return (
    <div className="space-y-3">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 font-mono text-[11px] text-danger"
        >
          {error}
        </p>
      )}

      {/* Flush to the container edges so a half-visible column at the right
          shows there is more board to scroll to. */}
      <div className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-3 sm:-mx-8 sm:px-8">
        {columns.map((column) => {
          const isOver = over === column.key && droppable(column.key);

          return (
            <div
              key={column.key}
              onDragOver={(e) => {
                if (!droppable(column.key)) return;
                e.preventDefault();
                setOver(column.key);
              }}
              onDragLeave={() => setOver((c) => (c === column.key ? null : c))}
              onDrop={(e) => onDrop(e, column.key)}
              className={`flex w-[266px] shrink-0 snap-start flex-col rounded-2xl border transition-colors ${
                isOver
                  ? 'border-accent/50 bg-accent-soft/40'
                  : 'border-line bg-surface'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2 border-b border-line-soft px-4 py-3">
                <Eyebrow>{column.label}</Eyebrow>
                <span className="tabular font-mono text-[12px] text-muted">
                  {column.cards.length}
                </span>
              </div>

              <div className="flex-1 space-y-2 p-2.5">
                {column.cards.length === 0 && (
                  <p className="px-2 py-6 text-center text-[13px] text-muted italic">
                    vacío
                  </p>
                )}

                {column.cards.map((card) => (
                  <article
                    key={card.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', card.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragging(card.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={`cursor-grab rounded-xl border border-line bg-raised p-3 shadow-card transition-opacity active:cursor-grabbing ${
                      dragging === card.id || busy === card.id
                        ? 'opacity-40'
                        : 'opacity-100'
                    }`}
                  >
                    <h3 className="text-[15px] leading-snug font-medium text-ink">
                      {card.fullName}
                    </h3>
                    {card.company && (
                      <p className="mt-0.5 text-[13px] text-ink-soft">
                        {card.company}
                      </p>
                    )}
                    <p className="mt-1 truncate font-mono text-[11px] text-muted">
                      {card.email}
                    </p>

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <span className="tabular font-mono text-[11px] text-muted">
                        score {Math.round(card.score)}
                      </span>
                      {card.closeProbability !== null && (
                        <Badge tone="accent">
                          {Math.round(card.closeProbability)}% cierre
                        </Badge>
                      )}
                      {card.tags.map((tag) => (
                        <Badge key={tag} tone="neutral">
                          {tag}
                        </Badge>
                      ))}
                    </div>

                    <label className="mt-2.5 block border-t border-line-soft pt-2">
                      <span className="sr-only">
                        Mover {card.fullName} a otra etapa
                      </span>
                      <select
                        value={card.stage}
                        disabled={busy === card.id}
                        onChange={(e) => void move(card.id, e.target.value)}
                        className="w-full cursor-pointer bg-transparent font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted hover:text-ink"
                      >
                        <option value={card.stage}>
                          {stageLabel(card.stage)}
                        </option>
                        {stages
                          .filter(
                            (s) => s.key !== card.stage && droppable(s.key),
                          )
                          .map((s) => (
                            <option key={s.key} value={s.key}>
                              → {s.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
