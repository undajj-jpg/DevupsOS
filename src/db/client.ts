import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as raw } from 'drizzle-orm';
import * as schema from './schema';
import { env } from '@/lib/env';

let client: postgres.Sql | null = null;

function connection(): postgres.Sql {
  if (!client) {
    client = postgres(env().DATABASE_URL, {
      // Serverless: keep the pool tiny and let idle sockets die quickly.
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      // Required behind a transaction-mode pooler (Supabase Supavisor on port
      // 6543, PgBouncer, Neon's pooled endpoint): a prepared statement is
      // bound to a server connection, and transaction pooling hands out a
      // different one per transaction, so a cached statement handle would
      // eventually be sent to a connection that has never seen it.
      prepare: false,
    });
  }
  return client;
}

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export function db(): Database {
  return drizzle(connection(), { schema });
}

export type OrgContext = {
  orgId: string;
  userId: string;
  /** owner | admin | member | service */
  role: string;
};

/**
 * Runs `fn` inside a transaction whose RLS context is pinned to `ctx`.
 *
 * Everything that touches tenant data must go through here. SET LOCAL scopes
 * the settings to this transaction, so a pooled connection handed to the next
 * request cannot inherit the previous tenant's identity.
 */
export async function withOrgContext<T>(
  ctx: OrgContext,
  fn: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(
      raw`select set_config('app.current_org_id', ${ctx.orgId}, true),
                 set_config('app.current_user_id', ${ctx.userId}, true),
                 set_config('app.current_role', ${ctx.role}, true)`,
    );
    return fn(tx);
  });
}

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export { schema };
