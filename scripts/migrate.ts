/**
 * Versioned migration runner.
 *
 * Applies every .sql file in db/migrations in filename order exactly once,
 * recording each in _migrations. Files are executed whole (simple query
 * protocol) because the RLS migration contains DO $$ ... $$ blocks that a
 * naive semicolon split would tear apart.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to run migrations');

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const applied = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM _migrations`).map(
        (r) => r.name,
      ),
    );

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      // Drizzle emits these markers; they are comments to Postgres but we
      // strip them so the file reads as one plain script.
      const script = body.split('--> statement-breakpoint').join('\n');

      process.stdout.write(`applying ${file} ... `);
      await sql.begin(async (tx) => {
        await tx.unsafe(script).simple();
        await tx`INSERT INTO _migrations (name) VALUES (${file})`;
      });
      process.stdout.write('ok\n');
      ran++;
    }

    console.log(ran === 0 ? 'already up to date' : `applied ${ran} migration(s)`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
