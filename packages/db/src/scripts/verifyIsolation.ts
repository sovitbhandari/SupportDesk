import { Pool } from "pg";
import { databaseUrl } from "../config.js";

async function getUserContext(adminPool: Pool) {
  const query = `
    SELECT
      acme_user.id AS acme_user_id,
      acme_org.id AS acme_org_id,
      globex_ticket.id AS globex_ticket_id,
      acme_ticket.id AS acme_ticket_id
    FROM organizations acme_org
    JOIN users acme_user ON acme_user.organization_id = acme_org.id
    JOIN organizations globex_org ON globex_org.slug = 'globex'
    JOIN tickets globex_ticket ON globex_ticket.organization_id = globex_org.id
    JOIN tickets acme_ticket ON acme_ticket.organization_id = acme_org.id
    WHERE acme_org.slug = 'acme'
      AND acme_user.email = 'adam.agent@acme.com'
    LIMIT 1;
  `;

  const { rows } = await adminPool.query(query);
  if (rows.length === 0) {
    throw new Error("Required seed data not found. Run seed first.");
  }

  return rows[0] as {
    acme_user_id: string;
    acme_org_id: string;
    globex_ticket_id: string;
    acme_ticket_id: string;
  };
}

async function run() {
  const adminPool = new Pool({ connectionString: databaseUrl });
  const appUserPool = new Pool({
    connectionString: "postgresql://app_user:app_user_password@localhost:5432/supportdesk"
  });

  try {
    const context = await getUserContext(adminPool);

    await appUserPool.query("BEGIN");
    await appUserPool.query("SELECT set_config('app.current_user_id', $1, true)", [context.acme_user_id]);

    const ownTicket = await appUserPool.query("SELECT id FROM tickets WHERE id = $1", [context.acme_ticket_id]);
    const crossTenantTicket = await appUserPool.query("SELECT id FROM tickets WHERE id = $1", [context.globex_ticket_id]);

    await appUserPool.query("ROLLBACK");

    if (ownTicket.rowCount !== 1) {
      throw new Error("Expected Org A user to read Org A ticket, but row was not visible.");
    }

    if (crossTenantTicket.rowCount !== 0) {
      throw new Error("RLS violation: Org A user was able to read Org B ticket.");
    }

    console.log("RLS isolation verified: Org A user cannot read Org B ticket.");
  } finally {
    await adminPool.end();
    await appUserPool.end();
  }
}

run().catch((error) => {
  console.error("Isolation verification failed:", error.message);
  process.exit(1);
});
