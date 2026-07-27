import type { ReactNode } from 'react';

/**
 * Shared primitives.
 *
 * The rule the whole console follows: monospace for anything an operator
 * scans or cross-references (labels, counts, timestamps, boletín numbers),
 * serif for anything they read (titles, descriptions, message bodies).
 */

/** Small uppercase monospace label. The workhorse of the metadata layer. */
export function Eyebrow({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`font-mono text-[11px] uppercase tracking-[0.14em] text-muted ${className}`}
    >
      {children}
    </span>
  );
}

export function LiveDot({ tone = 'accent' }: { tone?: 'accent' | 'ok' | 'muted' }) {
  const color =
    tone === 'ok' ? 'bg-ok' : tone === 'muted' ? 'bg-muted' : 'bg-accent';
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      <span className={`live-dot absolute inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: ReactNode;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="font-display text-[28px] leading-[1.15] font-semibold tracking-[-0.01em] text-ink sm:text-[34px]">
          {title}
        </h1>
        {lede && (
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
            {lede}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  description,
  aside,
  children,
  className = '',
}: {
  title?: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-line bg-surface shadow-card ${className}`}
    >
      {(title || aside) && (
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div className="min-w-0">
            {title && <Eyebrow>{title}</Eyebrow>}
            {description && (
              <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">
                {description}
              </p>
            )}
          </div>
          {aside && <div className="shrink-0">{aside}</div>}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'neutral' | 'accent';
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-card">
      <Eyebrow>{label}</Eyebrow>
      <div
        className={`tabular mt-2 font-display text-[32px] leading-none font-semibold ${
          tone === 'accent' ? 'text-accent' : 'text-ink'
        }`}
      >
        {value}
      </div>
      {hint && <p className="mt-2 text-[13px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

const TONE: Record<string, string> = {
  ok: 'bg-ok-soft text-ok border-ok/20',
  warn: 'bg-warn-soft text-warn border-warn/20',
  danger: 'bg-danger-soft text-danger border-danger/20',
  accent: 'bg-accent-soft text-accent-ink border-accent/20',
  neutral: 'bg-line-soft text-ink-soft border-line',
};

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
}: {
  children: ReactNode;
  tone?: keyof typeof TONE | string;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] whitespace-nowrap ${
        TONE[tone] ?? TONE.neutral
      }`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="border-b border-line pb-2 font-mono text-[10.5px] font-normal uppercase tracking-[0.12em] text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return (
    <tr className="border-b border-line-soft align-top last:border-0">
      {children}
    </tr>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="mx-auto max-w-sm text-[15px] leading-relaxed text-muted italic">
        {children}
      </p>
    </div>
  );
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'ok';
}) {
  const styles: Record<string, string> = {
    primary:
      'bg-accent text-white border-accent hover:bg-accent-ink disabled:hover:bg-accent',
    ghost:
      'bg-transparent text-ink border-line hover:bg-line-soft disabled:hover:bg-transparent',
    danger:
      'bg-danger text-white border-danger hover:brightness-95 disabled:hover:brightness-100',
    ok: 'bg-ok text-white border-ok hover:brightness-95 disabled:hover:brightness-100',
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Thin bar for showing a value against a ceiling — warmup caps, quotas. */
export function Meter({
  value,
  max,
  tone = 'accent',
}: {
  value: number;
  max: number;
  tone?: 'accent' | 'ok' | 'warn';
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const bar = tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : 'bg-accent';
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-line-soft"
      role="img"
      aria-label={`${value} de ${max}`}
    >
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
