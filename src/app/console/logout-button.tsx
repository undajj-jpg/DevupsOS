'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        // The route replies with JSON, so navigate here rather than letting a
        // form submission render the payload.
        await fetch('/api/auth/logout', { method: 'POST' });
        router.replace('/login');
        router.refresh();
      }}
      className="rounded-lg border border-line px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted transition-colors hover:bg-line-soft hover:text-ink disabled:opacity-50"
    >
      {busy ? '…' : 'Salir'}
    </button>
  );
}
