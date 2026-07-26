import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/console', label: 'Dashboard' },
  { href: '/console/leads', label: 'Leads' },
  { href: '/console/approvals', label: 'Approvals' },
  { href: '/console/replies', label: 'Replies' },
  { href: '/console/agents', label: 'Agents' },
];

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await currentSession();
  if (!session) redirect('/login');

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-line)] bg-white dark:border-white/10 dark:bg-white/5">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/console" className="text-sm font-semibold">
            DevUps Growth OS
          </Link>
          <nav className="flex flex-1 gap-4 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[var(--color-muted)] hover:text-[var(--color-ink)] dark:hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <span className="text-xs text-[var(--color-muted)]">
            {session.email} · {session.role}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
