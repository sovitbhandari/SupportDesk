import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { databaseUrl } from "../config.js";

const appDatabaseUrl =
  process.env.APP_DATABASE_URL ?? "postgresql://app_user:app_user_password@localhost:55432/supportdesk";

async function getSeedContext(ownerPool: Pool) {
  const result = await ownerPool.query(
    `
    SELECT u.id AS user_id, u.organization_id
    FROM users u
    JOIN organization_memberships om
      ON om.user_id = u.id
      AND om.organization_id = u.organization_id
    JOIN roles r ON r.id = om.role_id
    WHERE u.email = 'alice.customer@acme.com'
      AND r.key = 'customer'
      AND u.is_active = true
    LIMIT 1
    `
  );

  if (result.rowCount !== 1) {
    throw new Error("Required Acme customer seed data not found. Run migrations and seed first.");
  }

  return result.rows[0] as { user_id: string; organization_id: string };
}

async function run() {
  const ownerPool = new Pool({ connectionString: databaseUrl });
  const appPool = new Pool({ connectionString: appDatabaseUrl });
  const appClient = await appPool.connect();
  const subject = `Outbox rollback verification ${randomUUID()}`;
  let ticketId: string | undefined;
  let outboxId: string | undefined;
  let transactionOpen = false;

  try {
    const context = await getSeedContext(ownerPool);

    await appClient.query("BEGIN");
    transactionOpen = true;
    await appClient.query("SELECT set_config('app.current_user_id', $1, true)", [context.user_id]);

    const ticket = await appClient.query<{ id: string }>(
      `
      INSERT INTO tickets(organization_id, requester_id, subject, description, status, priority)
      VALUES($1, $2, $3, 'Rollback verifier should not persist this ticket.', 'open', 'low')
      RETURNING id
      `,
      [context.organization_id, context.user_id, subject]
    );
    ticketId = ticket.rows[0].id;

    const outbox = await appClient.query<{ id: string }>(
      `
      INSERT INTO outbox_events(organization_id, event_type, schema_version, aggregate_type, aggregate_id, payload)
      VALUES($1, 'ticket.created.notification_requested', 1, 'ticket', $2, $3::jsonb)
      RETURNING id
      `,
      [
        context.organization_id,
        ticketId,
        JSON.stringify({ ticketId, requesterId: context.user_id })
      ]
    );
    outboxId = outbox.rows[0].id;

    await appClient.query(
      `
      INSERT INTO audit_logs(organization_id, actor_user_id, event_type, payload)
      VALUES($1, $2, 'ticket.created', $3::jsonb)
      `,
      [
        context.organization_id,
        context.user_id,
        JSON.stringify({ ticketId, verifier: "outbox-rollback" })
      ]
    );

    await appClient.query("ROLLBACK");
    transactionOpen = false;

    const persisted = await ownerPool.query(
      `
      SELECT
        (SELECT COUNT(*)::int FROM tickets WHERE id = $1) AS tickets,
        (SELECT COUNT(*)::int FROM outbox_events WHERE id = $2) AS outbox_events,
        (
          SELECT COUNT(*)::int
          FROM audit_logs
          WHERE payload->>'ticketId' = $1::text
            AND event_type = 'ticket.created'
        ) AS audit_logs
      `,
      [ticketId, outboxId]
    );
    const row = persisted.rows[0] as { tickets: number; outbox_events: number; audit_logs: number };
    if (row.tickets !== 0 || row.outbox_events !== 0 || row.audit_logs !== 0) {
      throw new Error("Rollback leaked ticket, outbox, or audit rows.");
    }

    console.log("Outbox transaction rollback verified: ticket, outbox, and audit rows roll back together.");
  } finally {
    if (transactionOpen) {
      try {
        await appClient.query("ROLLBACK");
      } catch {
        // no-op: preserve the original verification error
      }
    }
    appClient.release();
    await ownerPool.end();
    await appPool.end();
  }
}

run().catch((error) => {
  console.error("Outbox verification failed:", error.message);
  process.exit(1);
});
