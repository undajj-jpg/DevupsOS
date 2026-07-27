/**
 * Marks migrations as applied without running them.
 *
 * Needed when the schema was created by something other than this runner — a
 * Supabase/Neon dashboard, a platform migration tool, or a database restored
 * from a dump. Without it, the next `db:migrate` would try to re-run
 * `0000_init.sql` against tables that already exist and fail.
 *
 *   npm run db:baseline            # mark every migration file as applied
 *   npm run db:baseline -- 0000_init.sql 0001_rls.sql
 *
 * This only writes bookkeeping rows. It never executes SQL and never skips a
 * migration you have not actually applied — verify with db:verify-rls
 * afterwards, which checks the schema rather than the ledger.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const onDisk = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const targets = requested.length > 0 ? requested : onDisk;

    const unknown = targets.filter((t) => !onDisk.includes(t));
    if (unknown.length > 0) {
      throw new Error(`no such migration file: ${unknown.join(', ')}`);
    }

    let marked = 0;
    for (const name of targets) {
      const rows = await sql`
        INSERT INTO _migrations (name) VALUES (${name})
        ON CONFLICT (name) DO NOTHING
        RETURNING name
      `;
      if (rows.length > 0) {
        console.log(`marked ${name} as applied`);
        marked++;
      } else {
        console.log(`${name} was already recorded`);
      }
    }

    console.log(
      marked === 0
        ? 'nothing to do — the ledger already matches'
        : `baselined ${marked} migration(s); db:migrate will now skip them`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
