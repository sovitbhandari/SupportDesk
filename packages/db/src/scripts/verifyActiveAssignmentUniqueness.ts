import { Pool } from "pg";
import { databaseUrl } from "../config.js";

type SeedContext = {
  organization_id: string;
  ticket_id: string;
  agent_id: string;
};

async function getSeedContext(pool: Pool): Promise<SeedContext> {
  const result = await pool.query(
    `
    SELECT t.organization_id, t.id AS ticket_id, u.id AS agent_id
    FROM tickets t
    JOIN users u ON u.organization_id = t.organization_id
    JOIN organization_memberships om ON om.user_id = u.id AND om.organization_id = u.organization_id
    JOIN roles r ON r.id = om.role_id
    WHERE r.key = 'agent'
    ORDER BY t.created_at ASC
    LIMIT 1
    `
  );

  if (result.rowCount !== 1) {
    throw new Error("Required seed ticket and agent not found. Run migrations and seed first.");
  }

  return result.rows[0] as SeedContext;
}

async function run() {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    const context = await getSeedContext(pool);

    await client.query("BEGIN");
    transactionOpen = true;
    await client.query(
      `
      INSERT INTO ticket_assignments(organization_id, ticket_id, agent_id)
      VALUES($1, $2, $3)
      `,
      [context.organization_id, context.ticket_id, context.agent_id]
    );

    await client.query("SAVEPOINT duplicate_active_assignment_check");
    let duplicateRejected = false;
    try {
      await client.query(
        `
        INSERT INTO ticket_assignments(organization_id, ticket_id, agent_id)
        VALUES($1, $2, $3)
        `,
        [context.organization_id, context.ticket_id, context.agent_id]
      );
    } catch (error) {
      const pgError = error as { code?: string };
      duplicateRejected = pgError.code === "23505";
      await client.query("ROLLBACK TO SAVEPOINT duplicate_active_assignment_check");
      if (!duplicateRejected) {
        throw error;
      }
    }
    await client.query("RELEASE SAVEPOINT duplicate_active_assignment_check");

    if (!duplicateRejected) {
      throw new Error("Expected duplicate active assignment insert to fail with PostgreSQL 23505.");
    }

    await client.query(
      `
      INSERT INTO ticket_assignments(organization_id, ticket_id, agent_id, released_at)
      VALUES($1, $2, $3, now())
      `,
      [context.organization_id, context.ticket_id, context.agent_id]
    );

    await client.query("ROLLBACK");
    transactionOpen = false;
    console.log("Active assignment uniqueness verified: duplicate active rows are rejected while released history is allowed.");
  } finally {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // no-op: preserve the original verification error
      }
    }
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error("Active assignment uniqueness verification failed:", error.message);
  process.exit(1);
});
