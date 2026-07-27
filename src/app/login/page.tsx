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
      setError(body?.error?.message ?? 'Algo salió mal');
      return;
    }

    router.push('/console');
    router.refresh();
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Left: what this thing is. Present on wide screens only — on a phone
          the person is signing in, not being sold to. */}
      <section className="hidden flex-col justify-between border-r border-line px-12 py-14 lg:flex">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-[19px] font-semibold text-ink">
            DevUps
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-accent">
            Growth OS
          </span>
        </div>

        <div className="max-w-lg">
          <h1 className="font-display text-[44px] leading-[1.08] font-semibold tracking-[-0.015em] text-ink">
            Outbound que se detiene{' '}
            <span className="text-accent italic">antes</span> de enviar.
          </h1>
          <p className="mt-5 text-[16px] leading-relaxed text-ink-soft">
            Sourcing, verificación, personalización con señal y triage de
            respuestas. Los lotes producen borradores; el paso a la cola lo hace
            una persona, nunca un agente.
          </p>

          <ul className="mt-9 space-y-3.5">
            {[
              ['Supresión bloqueante', 'antes que score, cupo o cadencia'],
              ['Anti-reenvío', 'registro de contactados por organización'],
              ['Aislamiento RLS', 'lo garantiza Postgres, no el código'],
              ['Modo sugerencia', 'hasta superar la puerta de autonomía'],
            ].map(([title, detail]) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span className="text-[15px] leading-snug">
                  <span className="text-ink">{title}</span>
                  <span className="text-muted"> — {detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          Fase 1 · núcleo · staff augmentation nearshore
        </p>
      </section>

      {/* Right: the form. */}
      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="font-display text-[19px] font-semibold text-ink">
              DevUps
            </span>{' '}
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-accent">
              Growth OS
            </span>
          </div>

          <h2 className="font-display text-[26px] leading-tight font-semibold text-ink">
            {mode === 'login' ? 'Entrar' : 'Crear organización'}
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
            {mode === 'login'
              ? 'Accedé a la consola de outbound.'
              : 'La primera cuenta queda como owner. Después podés sumar al equipo.'}
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            {mode === 'signup' && (
              <>
                <Field label="Organización" name="orgName" required minLength={2} />
                <Field label="Tu nombre" name="name" required minLength={2} />
              </>
            )}
            <Field label="Email" name="email" type="email" required autoComplete="email" />
            <Field
              label="Contraseña"
              name="password"
              type="password"
              required
              minLength={mode === 'signup' ? 12 : 1}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              hint={mode === 'signup' ? 'Mínimo 12 caracteres.' : undefined}
            />

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg border border-accent bg-accent px-4 py-2.5 font-mono text-[11.5px] uppercase tracking-[0.11em] text-white transition-colors hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? 'Un momento…'
                : mode === 'login'
                  ? 'Entrar'
                  : 'Crear organización'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError(null);
            }}
            className="mt-6 font-mono text-[11px] uppercase tracking-[0.1em] text-muted underline decoration-line underline-offset-4 transition-colors hover:text-accent"
          >
            {mode === 'login' ? 'Crear una organización nueva' : 'Ya tengo cuenta'}
          </button>
        </div>
      </section>
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
      <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      <input
        {...props}
        className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink outline-none transition-colors placeholder:text-muted focus:border-accent"
      />
      {hint && (
        <span className="mt-1.5 block font-mono text-[10.5px] text-muted">
          {hint}
        </span>
      )}
    </label>
  );
}
