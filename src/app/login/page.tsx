'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'login' | 'signup';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload =
      mode === 'login'
        ? {
            email: String(form.get('email') ?? ''),
            password: String(form.get('password') ?? ''),
          }
        : {
            orgName: String(form.get('orgName') ?? ''),
            name: String(form.get('name') ?? ''),
            email: String(form.get('email') ?? ''),
            password: String(form.get('password') ?? ''),
          };

    const res = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Something went wrong');
      return;
    }

    router.push('/console');
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="rounded-xl border border-[var(--color-line)] bg-white p-8 shadow-sm dark:border-white/10 dark:bg-white/5">
        <h1 className="text-xl font-semibold">DevUps Growth OS</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {mode === 'login'
            ? 'Sign in to the outbound console.'
            : 'Create an organization and its first owner.'}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === 'signup' && (
            <>
              <Field label="Organization" name="orgName" required minLength={2} />
              <Field label="Your name" name="name" required minLength={2} />
            </>
          )}
          <Field label="Email" name="email" type="email" required />
          <Field
            label="Password"
            name="password"
            type="password"
            required
            minLength={mode === 'signup' ? 12 : 1}
            hint={mode === 'signup' ? 'At least 12 characters.' : undefined}
          />

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--color-danger)] dark:bg-red-500/10">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create organization'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setError(null);
          }}
          className="mt-4 text-sm text-[var(--color-accent)] underline"
        >
          {mode === 'login' ? 'Create a new organization' : 'I already have an account'}
        </button>
      </div>
    </main>
  );
}

function Field({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        {...props}
        className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] dark:border-white/15 dark:bg-white/5"
      />
      {hint && <span className="mt-1 block text-xs text-[var(--color-muted)]">{hint}</span>}
    </label>
  );
}
