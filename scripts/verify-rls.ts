/**
 * Asserts that RLS is enabled AND forced on every tenant table, and that each
 * one carries a policy.
 *
 * This runs in CI because RLS is the isolation boundary: adding a table and
 * forgetting to enable RLS on it is a silent cross-tenant data leak that no
 * unit test would catch. A new table fails this check until it is either
 * protected or explicitly listed as non-tenant.
 */
import postgres from 'postgres';

/**
 * Tables that legitimately hold no tenant data. Everything else must be
 * protected. Keep this list short and justify each entry.
 */
const NON_TENANT_TABLES = new Set([
  '_migrations', // migration bookkeeping
  'rate_limits', // keyed by hashed token/IP; exists before a tenant does
]);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const failures: string[] = [];

  try {
    // Policies are worthless if the connecting role outranks them. A superuser
    // or a BYPASSRLS role reads every tenant's data no matter what the policies
    // say, and does so silently — so this is checked first and loudly.
    const [role] = await sql<
      { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]
    >`
      SELECT rolname, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `;

    if (role?.rolsuper) {
      failures.push(
        `connected as "${role.rolname}", which is a SUPERUSER — superusers bypass every RLS policy. ` +
          'Point DATABASE_URL at the devups_app role (see db/migrations/0004_app_role.sql).',
      );
    }
    if (role?.rolbypassrls) {
      failures.push(
        `connected as "${role.rolname}", which has BYPASSRLS — it ignores every RLS policy.`,
      );
    }

    const tables = await sql<
      { tablename: string; rowsecurity: boolean; forcerowsecurity: boolean }[]
    >`
      SELECT c.relname AS tablename,
             c.relrowsecurity AS rowsecurity,
             c.relforcerowsecurity AS forcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `;

    const policies = await sql<{ tablename: string; n: number }[]>`
      SELECT tablename, count(*)::int AS n
      FROM pg_policies WHERE schemaname = 'public'
      GROUP BY tablename
    `;
    const policyCount = new Map(policies.map((p) => [p.tablename, p.n]));

    let checked = 0;
    for (const table of tables) {
      if (NON_TENANT_TABLES.has(table.tablename)) continue;
      checked++;

      if (!table.rowsecurity) {
        failures.push(`${table.tablename}: ROW LEVEL SECURITY is not enabled`);
      }
      // Without FORCE, the table owner bypasses every policy — and on most
      // hosted Postgres the application connects as the owner.
      if (!table.forcerowsecurity) {
        failures.push(`${table.tablename}: FORCE ROW LEVEL SECURITY is not set`);
      }
      if ((policyCount.get(table.tablename) ?? 0) === 0) {
        failures.push(`${table.tablename}: has RLS but no policy (denies all)`);
      }
    }

    if (checked === 0) {
      throw new Error('no tenant tables found — did migrations run?');
    }

    if (failures.length > 0) {
      console.error('RLS verification failed:\n' + failures.map((f) => `  - ${f}`).join('\n'));
      process.exit(1);
    }

    console.log(`RLS verified on ${checked} tenant tables`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
