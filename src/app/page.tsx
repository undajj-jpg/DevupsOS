import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await currentSession();
  redirect(session ? '/console' : '/login');
}
