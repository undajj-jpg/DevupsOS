'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button } from '@/components/ui';

export type Draft = {
  id: string;
  subject: string;
  body: string;
  variantKey: string | null;
  contactEmail: string;
  contactName: string;
  company: string | null;
};

export function ApprovalList({ drafts }: { drafts: Draft[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = selected.size === drafts.length && drafts.length > 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function approve() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);

    const res = await fetch('/api/messages/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageIds: [...selected] }),
    });

    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'No se pudo aprobar');
      return;
    }

    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-line-soft pb-4">
        <Button onClick={approve} disabled={busy || selected.size === 0}>
          {busy
            ? 'Aprobando…'
            : selected.size > 0
              ? `Aprobar ${selected.size}`
              : 'Aprobar'}
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            setSelected(allSelected ? new Set() : new Set(drafts.map((d) => d.id)))
          }
        >
          {allSelected ? 'Ninguno' : 'Todos'}
        </Button>
        {error && (
          <span className="font-mono text-[11px] text-danger">{error}</span>
        )}
      </div>

      <ul className="space-y-3">
        {drafts.map((draft) => {
          const checked = selected.has(draft.id);
          return (
            <li key={draft.id}>
              <label
                className={`block cursor-pointer rounded-xl border p-4 transition-colors ${
                  checked
                    ? 'border-accent/40 bg-accent-soft/40'
                    : 'border-line bg-raised hover:border-line'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(draft.id)}
                    className="mt-1.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-[17px] leading-snug font-semibold text-ink">
                        {draft.subject}
                      </h3>
                      {draft.variantKey && (
                        <Badge tone="neutral">var {draft.variantKey}</Badge>
                      )}
                      <Badge tone="warn">sin enviar</Badge>
                    </div>

                    <div className="mt-1 font-mono text-[11.5px] text-muted">
                      {draft.contactName} · {draft.contactEmail}
                      {draft.company ? ` · ${draft.company}` : ''}
                    </div>

                    <div className="mt-3 border-l-2 border-line pl-4">
                      <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap text-ink-soft">
                        {draft.body}
                      </p>
                    </div>
                  </div>
                </div>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
