'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/console', label: 'Panel' },
  { href: '/console/leads', label: 'Leads' },
  { href: '/console/pipeline', label: 'Pipeline' },
  { href: '/console/approvals', label: 'Aprobaciones' },
  { href: '/console/replies', label: 'Respuestas' },
  { href: '/console/analytics', label: 'Conversión' },
  { href: '/console/agents', label: 'Agentes' },
];

export function ConsoleNav({ pending }: { pending: number }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
      {NAV.map((item) => {
        // Exact match for the index so every child route doesn't light it up.
        const active =
          item.href === '/console'
            ? pathname === '/console'
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`relative rounded-lg px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.11em] whitespace-nowrap transition-colors ${
              active
                ? 'bg-accent-soft text-accent-ink'
                : 'text-muted hover:bg-line-soft hover:text-ink'
            }`}
          >
            {item.label}
            {item.href === '/console/approvals' && pending > 0 && (
              <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[9.5px] text-white tabular">
                {pending}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
