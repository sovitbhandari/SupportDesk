import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { databaseUrl } from "../config.js";

const appDatabaseUrl =
  process.env.APP_DATABASE_URL ?? "postgresql://app_user:app_user_password@localhost:55432/supportdesk";

async function getSeedContext(ownerPool: Pool) {
  const result = await ownerPool.query(
    `
    SELECT
      u.id AS user_id,
      u.organization_id,
      t.id AS ticket_id
    FROM users u
    JOIN tickets t
      ON t.requester_id = u.id
      AND t.organization_id = u.organization_id
    WHERE u.email = 'alice.customer@acme.com'
    ORDER BY t.created_at ASC
    LIMIT 1
    `
  );

  if (result.rowCount !== 1) {
    throw new Error("Required Acme customer ticket not found. Run migrations and seed first.");
  }

  return result.rows[0] as {
    user_id: string;
    organization_id: string;
    ticket_id: string;
  };
}

async function run() {
  const ownerPool = new Pool({ connectionString: databaseUrl });
  const appPool = new Pool({ connectionString: appDatabaseUrl });
  const appClient = await appPool.connect();
  let transactionOpen = false;

  try {
    const context = await getSeedContext(ownerPool);
    await appClient.query("BEGIN");
    transactionOpen = true;
    await appClient.query("SELECT set_config('app.current_user_id', $1, true)", [context.user_id]);
    await appClient.query("SELECT id FROM tickets WHERE id = $1 AND organization_id = $2 FOR UPDATE", [
      context.ticket_id,
      context.organization_id
    ]);
    await appClient.query(
      `
      INSERT INTO ticket_event_counters(organization_id, ticket_id, next_sequence)
      VALUES($1, $2, 1)
      ON CONFLICT (organization_id, ticket_id) DO NOTHING
      `,
      [context.organization_id, context.ticket_id]
    );

    const eventIds: string[] = [];
    const sequences: number[] = [];
    for (const label of ["first", "second"]) {
      const counter = await appClient.query<{ sequence: string }>(
        `
        UPDATE ticket_event_counters
        SET next_sequence = next_sequence + 1,
            updated_at = now()
        WHERE organization_id = $1 AND ticket_id = $2
        RETURNING next_sequence - 1 AS sequence
        `,
        [context.organization_id, context.ticket_id]
      );
      const sequence = Number(counter.rows[0].sequence);
      const message = await appClient.query<{ id: string }>(
        `
        INSERT INTO messages(organization_id, ticket_id, author_id, body)
        VALUES($1, $2, $3, $4)
        RETURNING id
        `,
        [
          context.organization_id,
          context.ticket_id,
          context.user_id,
          `Replay verifier ${label} ${randomUUID()}`
        ]
      );
      const event = await appClient.query<{ id: string }>(
        `
        INSERT INTO ticket_events(
          organization_id, ticket_id, sequence, event_type, message_id, actor_user_id, payload
        )
        VALUES($1, $2, $3, 'ticket.message.created', $4, $5, $6::jsonb)
        RETURNING id
        `,
        [
          context.organization_id,
          context.ticket_id,
          sequence,
          message.rows[0].id,
          context.user_id,
          JSON.stringify({ messageId: message.rows[0].id })
        ]
      );
      sequences.push(sequence);
      eventIds.push(event.rows[0].id);
    }

    if (sequences[1] !== sequences[0] + 1) {
      throw new Error("Ticket event sequences were not contiguous.");
    }

    const catchup = await appClient.query<{ id: string; sequence: string }>(
      `
      SELECT id, sequence
      FROM ticket_events
      WHERE organization_id = $1
        AND ticket_id = $2
        AND sequence > $3
      ORDER BY sequence ASC
      `,
      [context.organization_id, context.ticket_id, sequences[0]]
    );
    if (catchup.rowCount !== 1 || catchup.rows[0].id !== eventIds[1]) {
      throw new Error("Catch-up query after the first sequence did not return only the second event.");
    }

    await appClient.query("ROLLBACK");
    transactionOpen = false;
    console.log("Ticket event replay verified: sequences are contiguous and cursor catch-up returns the expected event.");
  } finally {
    if (transactionOpen) {
      try {
        await appClient.query("ROLLBACK");
      } catch {
        // no-op: preserve original verifier error
      }
    }
    appClient.release();
    await ownerPool.end();
    await appPool.end();
  }
}

run().catch((error) => {
  console.error("Ticket event replay verification failed:", error.message);
  process.exit(1);
});
