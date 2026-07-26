/**
 * Development seed: one org, one owner, a warmed secondary mailbox and a
 * handful of leads with realistic signals.
 *
 * Refuses to run against production. The password is printed to stdout because
 * it is a throwaway for a local database — it is generated per run, not
 * hardcoded.
 */
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword } from '../src/lib/auth/password';
import { AGENT_ROSTER, DEFAULT_FUNNEL_STAGES } from '../src/core/bootstrap';
import { scoreLead } from '../src/core/scoring';

const SEED_LEADS = [
  {
    email: 'maria.silva@northwind-labs.com',
    fullName: 'Maria Silva',
    title: 'VP Engineering',
    company: 'Northwind Labs',
    employees: 280,
    stack: ['TypeScript', 'AWS', 'React'],
    language: 'en',
    signal: {
      kind: 'job_posting',
      summary: 'Three open Senior Node.js roles in New York, posted 6 days ago.',
    },
  },
  {
    email: 'j.pereira@brasilfin.com.br',
    fullName: 'João Pereira',
    title: 'Head of Engineering',
    company: 'BrasilFin',
    employees: 900,
    stack: ['Go', 'Kubernetes'],
    language: 'pt',
    signal: {
      kind: 'funding',
      summary: 'Announced a Series B two weeks ago, with hiring called out.',
    },
  },
  {
    email: 'ana.lopez@cordilleratech.mx',
    fullName: 'Ana López',
    title: 'CTO',
    company: 'Cordillera Tech',
    employees: 65,
    stack: ['Python', 'AWS'],
    language: 'es',
    signal: null,
  },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to seed a production database');
  }

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  try {
    const email = 'owner@devups.local';
    const password = randomBytes(12).toString('base64url');
    const passwordHash = await hashPassword(password);

    const [bootstrapped] = await sql<{ org_id: string; user_id: string }[]>`
      SELECT * FROM app.bootstrap_org('DevUps (dev)', ${email}, 'Dev Owner', ${passwordHash})
    `;
    if (!bootstrapped) throw new Error('bootstrap returned no rows');
    const { org_id: orgId, user_id: userId } = bootstrapped;

    // Everything below writes tenant data, so it runs inside an RLS context.
    await sql.begin(async (tx) => {
      await tx`
        SELECT set_config('app.current_org_id', ${orgId}, true),
               set_config('app.current_user_id', ${userId}, true),
               set_config('app.current_role', 'owner', true)
      `;

      await tx`
        INSERT INTO funnels (org_id, name, stages, active)
        VALUES (${orgId}, 'Outbound', ${JSON.stringify(DEFAULT_FUNNEL_STAGES)}::jsonb, true)
      `;

      for (const agent of AGENT_ROSTER) {
        await tx`
          INSERT INTO agents (org_id, key, name, allowed_tools, mode, enabled)
          VALUES (${orgId}, ${agent.key}, ${agent.name},
                  ${JSON.stringify(agent.allowedTools)}::jsonb, 'suggest', true)
        `;
      }

      // A secondary domain: the primary is deliberately excluded from cold
      // sending, so seeding only a primary would leave zero capacity.
      const [domain] = await tx<{ id: string }[]>`
        INSERT INTO domains (org_id, domain, is_primary, dmarc_policy)
        VALUES (${orgId}, 'send.devups.io', false, 'quarantine')
        RETURNING id
      `;

      await tx`
        INSERT INTO mailboxes (org_id, user_id, domain_id, email, warmup_stage,
                               warmup_started_at, daily_cap, health, status)
        VALUES (${orgId}, ${userId}, ${domain!.id}, 'ana@send.devups.io',
                'steady', now() - interval '40 days', 30, 1.0, 'active')
      `;

      for (const lead of SEED_LEADS) {
        const [account] = await tx<{ id: string }[]>`
          INSERT INTO accounts (org_id, name, employee_count, tech_stack)
          VALUES (${orgId}, ${lead.company}, ${lead.employees},
                  ${JSON.stringify(lead.stack)}::jsonb)
          RETURNING id
        `;

        const [contact] = await tx<{ id: string }[]>`
          INSERT INTO contacts (org_id, account_id, full_name, title, email,
                                email_verified, language)
          VALUES (${orgId}, ${account!.id}, ${lead.fullName}, ${lead.title},
                  ${lead.email}, true, ${lead.language})
          RETURNING id
        `;

        const score = scoreLead({
          hasSignal: Boolean(lead.signal),
          emailVerified: true,
          title: lead.title,
          employeeCount: lead.employees,
          techStack: lead.stack,
          language: lead.language,
        });

        await tx`
          INSERT INTO leads (org_id, contact_id, account_id, stage, score,
                             language, signal, source)
          VALUES (${orgId}, ${contact!.id}, ${account!.id}, 'new', ${score},
                  ${lead.language},
                  ${lead.signal ? JSON.stringify(lead.signal) : null}::jsonb,
                  'seed')
        `;
      }

      // A customer domain, to prove the suppression gate blocks on a real run.
      await tx`
        INSERT INTO suppression (org_id, value, reason, note)
        VALUES (${orgId}, '@existing-customer.com', 'customer',
                'seeded so the pre-send gate has something to block')
      `;
    });

    console.log('Seeded successfully.');
    console.log(`  org:      ${orgId}`);
    console.log(`  email:    ${email}`);
    console.log(`  password: ${password}`);
    console.log('\nSign in at /login, then run a batch from /console.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
