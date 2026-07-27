import { Badge, Card, Empty, Eyebrow, PageHeader } from '@/components/ui';
import { loadReplies, requirePageSession } from '@/lib/server-data';

export const dynamic = 'force-dynamic';

const CATEGORY: Record<string, { label: string; tone: string; icon: string }> = {
  interested: { label: 'interesado', tone: 'ok', icon: '◆' },
  referral: { label: 'derivación', tone: 'ok', icon: '↗' },
  not_interested: { label: 'no interesado', tone: 'warn', icon: '○' },
  unsubscribe: { label: 'baja', tone: 'danger', icon: '⊘' },
  out_of_office: { label: 'fuera de oficina', tone: 'neutral', icon: '◷' },
  auto_reply: { label: 'automática', tone: 'neutral', icon: '⟳' },
  other: { label: 'otra', tone: 'neutral', icon: '•' },
};

export default async function RepliesPage() {
  const session = await requirePageSession();
  const rows = await loadReplies(session);

  const unhandled = rows.filter((r) => !r.handled).length;

  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>Triage · entrada no confiable</Eyebrow>}
        title="Respuestas"
        lede="Clasificadas al llegar. La detección de baja es determinista y le gana al modelo: una baja suprime la dirección y corta la cadencia antes que cualquier otra cosa."
      />

      <Card
        title="Bandeja"
        aside={
          <span className="font-mono text-[12px] text-muted">
            {unhandled} sin atender · {rows.length} total
          </span>
        }
      >
        {rows.length === 0 ? (
          <Empty>Todavía no hay respuestas.</Empty>
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.map((reply) => {
              const meta = CATEGORY[reply.category ?? 'other'] ?? CATEGORY.other!;
              return (
                <li key={reply.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] text-ink">
                          {reply.contactName}
                        </span>
                        <Badge tone={meta.tone}>
                          <span aria-hidden>{meta.icon}</span>
                          {meta.label}
                        </Badge>
                        {!reply.handled && <Badge tone="accent">sin atender</Badge>}
                      </div>
                      <div className="mt-0.5 font-mono text-[11.5px] text-muted">
                        {reply.contactEmail}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tabular font-mono text-[13px] text-ink-soft">
                        {reply.closeProbability === null
                          ? '—'
                          : `${Math.round(reply.closeProbability * 100)}%`}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                        prob. cierre
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-line-soft bg-canvas px-4 py-3">
                    <p className="text-[14px] leading-relaxed text-ink-soft">
                      {reply.body.slice(0, 400)}
                      {reply.body.length > 400 ? '…' : ''}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
