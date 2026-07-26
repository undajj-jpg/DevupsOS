import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

/**
 * Integration test for the isolation boundary (spec §3.3).
 *
 * The unit tests cover the compliance logic; this covers the thing that
 * actually keeps one customer's leads away from another's. It runs against a
 * real Postgres and is skipped when TEST_DATABASE_URL is unset, so the default
 * `npm test` stays hermetic.
 *
 *   createdb devups_test
 *   DATABASE_URL=... npm run db:migrate
 *   TEST_DATABASE_URL=... npm test
 */

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('row level security', () => {
  const sql = postgres(url ?? '', { max: 1, prepare: false, onnotice: () => {} });

  let orgA = '';
  let orgB = '';
  let userA = '';
  let userB = '';
  let memberA = '';

  /** Runs `fn` with the RLS context of a given identity. */
  async function as<T>(
    ctx: { orgId: string; userId: string; role: string },
    fn: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    return sql.begin(async (tx) => {
      await tx`
        SELECT set_config('app.current_org_id', ${ctx.orgId}, true),
               set_config('app.current_user_id', ${ctx.userId}, true),
               set_config('app.current_role', ${ctx.role}, true)
      `;
      return fn(tx);
    }) as Promise<T>;
  }

  beforeAll(async () => {
    const suffix = Date.now().toString(36);

    const [a] = await sql<{ org_id: string; user_id: string }[]>`
      SELECT * FROM app.bootstrap_org(
        ${`Org A ${suffix}`}, ${`a-${suffix}@test.local`}, 'Owner A', 'hash')
    `;
    const [b] = await sql<{ org_id: string; user_id: string }[]>`
      SELECT * FROM app.bootstrap_org(
        ${`Org B ${suffix}`}, ${`b-${suffix}@test.local`}, 'Owner B', 'hash')
    `;

    orgA = a!.org_id;
    userA = a!.user_id;
    orgB = b!.org_id;
    userB = b!.user_id;

    await as({ orgId: orgA, userId: userA, role: 'owner' }, async (tx) => {
      const [member] = await tx<{ id: string }[]>`
        INSERT INTO users (org_id, email, name, role, password_hash)
        VALUES (${orgA}, ${`m-${suffix}@test.local`}, 'Member A', 'member', 'hash')
        RETURNING id
      `;
      memberA = member!.id;

      const [contact] = await tx<{ id: string }[]>`
        INSERT INTO contacts (org_id, full_name, email)
        VALUES (${orgA}, 'Lead A', ${`lead-${suffix}@a.test`})
        RETURNING id
      `;
      await tx`
        INSERT INTO leads (org_id, contact_id, stage, assigned_user_id)
        VALUES (${orgA}, ${contact!.id}, 'new', ${userA})
      `;
      await tx`
        INSERT INTO suppression (org_id, value, reason)
        VALUES (${orgA}, ${`blocked-${suffix}@a.test`}, 'manual')
      `;
    });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("org B cannot see org A's leads", async () => {
    const rows = await as({ orgId: orgB, userId: userB, role: 'owner' }, (tx) =>
      tx`SELECT id FROM leads`,
    );
    expect(rows).toHaveLength(0);
  });

  it("org B cannot see org A's suppression list", async () => {
    const rows = await as({ orgId: orgB, userId: userB, role: 'owner' }, (tx) =>
      tx`SELECT id FROM suppression`,
    );
    expect(rows).toHaveLength(0);
  });

  it("org B cannot see org A's contacts", async () => {
    const rows = await as({ orgId: orgB, userId: userB, role: 'owner' }, (tx) =>
      tx`SELECT id FROM contacts`,
    );
    expect(rows).toHaveLength(0);
  });

  it('org A sees its own leads', async () => {
    const rows = await as({ orgId: orgA, userId: userA, role: 'owner' }, (tx) =>
      tx`SELECT id FROM leads`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('org B cannot write a row into org A', async () => {
    await expect(
      as({ orgId: orgB, userId: userB, role: 'owner' }, (tx) =>
        tx`INSERT INTO suppression (org_id, value, reason)
           VALUES (${orgA}, 'smuggled@a.test', 'manual')`,
      ),
    ).rejects.toThrow();
  });

  it('a member does not see leads assigned to someone else', async () => {
    const rows = await as(
      { orgId: orgA, userId: memberA, role: 'member' },
      (tx) => tx`SELECT id FROM leads`,
    );
    expect(rows).toHaveLength(0);
  });

  it('a visibility grant makes exactly that lead visible to the member', async () => {
    const [lead] = await as(
      { orgId: orgA, userId: userA, role: 'owner' },
      (tx) => tx<{ id: string }[]>`SELECT id FROM leads LIMIT 1`,
    );

    await as({ orgId: orgA, userId: userA, role: 'owner' }, (tx) =>
      tx`INSERT INTO visibility_grants (org_id, user_id, resource_table, resource_id)
         VALUES (${orgA}, ${memberA}, 'leads', ${lead!.id})
         ON CONFLICT DO NOTHING`,
    );

    const rows = await as(
      { orgId: orgA, userId: memberA, role: 'member' },
      (tx) => tx<{ id: string }[]>`SELECT id FROM leads`,
    );
    expect(rows.map((r) => r.id)).toEqual([lead!.id]);
  });

  it('a session with no context set reads nothing at all', async () => {
    // The failure mode that matters: forgetting to establish context must deny,
    // not expose every tenant.
    const rows = await sql`SELECT id FROM leads`;
    expect(rows).toHaveLength(0);
  });

  it('bootstrap refuses a duplicate email', async () => {
    const email = `dup-${Date.now().toString(36)}@test.local`;
    await expect(
      sql`SELECT * FROM app.bootstrap_org('Dup', ${email}, 'X', 'h')`,
    ).resolves.toBeDefined();
    await expect(
      sql`SELECT * FROM app.bootstrap_org('Dup', ${email}, 'X', 'h')`,
    ).rejects.toThrow();
  });
});
