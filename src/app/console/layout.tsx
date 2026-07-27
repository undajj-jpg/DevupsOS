import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, count, eq } from 'drizzle-orm';
import { currentSession } from '@/lib/auth/session';
import { withOrgContext } from '@/db/client';
import { messages, orgs } from '@/db/schema';
import { ConsoleNav } from './console-nav';
import { LogoutButton } from './logout-button';
import { Badge } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await currentSession();
  if (!session) redirect('/login');

  // The header carries two things an operator should never have to go looking
  // for: how many drafts are waiting on them, and whether agents are live.
  const shell = await withOrgContext(
    { orgId: session.orgId, userId: session.userId, role: session.role },
    async (tx) => {
      const [org] = await tx
        .select({ name: orgs.name, agentsEnabled: orgs.agentsEnabled })
        .from(orgs)
        .where(eq(orgs.id, session.orgId))
        .limit(1);

      const [pending] = await tx
        .select({ n: count() })
        .from(messages)
        .where(
          and(
            eq(messages.orgId, session.orgId),
            eq(messages.status, 'pending_approval'),
          ),
        );

      return { org: org ?? null, pending: pending?.n ?? 0 };
    },
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3 sm:px-8">
          <Link href="/console" className="group flex items-baseline gap-2">
            <span className="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
              DevUps
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-accent">
              Growth OS
            </span>
          </Link>

          <span className="hidden h-4 w-px bg-line sm:block" />

          <ConsoleNav pending={shell.pending} />

          <div className="flex items-center gap-3">
            {!shell.org?.agentsEnabled && (
              <Badge tone="danger" dot>
                Detenido
              </Badge>
            )}
            <div className="hidden text-right leading-tight sm:block">
              <div className="font-mono text-[11px] text-ink-soft">
                {session.email}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                {shell.org?.name ?? '—'} · {session.role}
              </div>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-7 px-5 py-8 sm:px-8 sm:py-10">
        {children}
      </main>

      <footer className="mx-auto max-w-6xl px-5 pb-10 sm:px-8">
        <p className="border-t border-line pt-5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
          Modo sugerencia · ningún mensaje sale sin aprobación humana
        </p>
      </footer>
    </div>
  );
}
