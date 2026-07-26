import { Card, Empty } from '@/components/ui';
import { loadPendingApprovals, requirePageSession } from '@/lib/server-data';
import { ApprovalList } from './approval-list';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const session = await requirePageSession();
  const drafts = await loadPendingApprovals(session);

  return (
    <Card
      title="Drafts awaiting approval"
      description="Approving is the only path from draft to queued. Nothing here has been sent."
    >
      {drafts.length === 0 ? (
        <Empty>
          No drafts pending. Run a batch from the dashboard or POST to /api/batch.
        </Empty>
      ) : (
        <ApprovalList
          drafts={drafts.map((d) => ({
            id: d.id,
            subject: d.subject ?? '(no subject)',
            body: d.body,
            variantKey: d.variantKey,
            contactEmail: d.contactEmail,
            contactName: d.contactName,
            company: d.company,
          }))}
        />
      )}
    </Card>
  );
}
