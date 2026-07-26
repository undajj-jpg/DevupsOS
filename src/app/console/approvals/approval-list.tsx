'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui';

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
      setError(body?.error?.message ?? 'Approval failed');
      return;
    }

    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={approve}
          disabled={busy || selected.size === 0}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Approving…' : `Approve ${selected.size || ''}`.trim()}
        </button>
        <button
          type="button"
          onClick={() => setSelected(new Set(drafts.map((d) => d.id)))}
          className="text-sm text-[var(--color-accent)] underline"
        >
          Select all
        </button>
        {error && <span className="text-sm text-[var(--color-danger)]">{error}</span>}
      </div>

      <ul className="space-y-3">
        {drafts.map((draft) => (
          <li
            key={draft.id}
            className="rounded-lg border border-[var(--color-line)] p-4 dark:border-white/10"
          >
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={selected.has(draft.id)}
                onChange={() => toggle(draft.id)}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{draft.subject}</span>
                  {draft.variantKey && <Badge>variant {draft.variantKey}</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                  {draft.contactName} · {draft.contactEmail}
                  {draft.company ? ` · ${draft.company}` : ''}
                </div>
                <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm text-[var(--color-muted)]">
                  {draft.body}
                </pre>
              </div>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
