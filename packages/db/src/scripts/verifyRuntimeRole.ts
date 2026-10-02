import { Pool } from "pg";
import { databaseUrl } from "../config.js";

const appDatabaseUrl =
  process.env.APP_DATABASE_URL ?? "postgresql://app_user:app_user_password@localhost:55432/supportdesk";

async function getSeedContext(ownerPool: Pool) {
  const result = await ownerPool.query(
    `
    SELECT
      acme_user.id AS acme_user_id,
      acme_org.id AS acme_org_id,
      globex_ticket.id AS globex_ticket_id
    FROM organizations acme_org
    JOIN users acme_user ON acme_user.organization_id = acme_org.id
    JOIN organizations globex_org ON globex_org.slug = 'globex'
    JOIN tickets globex_ticket ON globex_ticket.organization_id = globex_org.id
    WHERE acme_org.slug = 'acme'
      AND acme_user.email = 'adam.agent@acme.com'
    LIMIT 1
    `
  );

  if (result.rowCount !== 1) {
    throw new Error("Required seed data not found. Run migrations and seed first.");
  }

  return result.rows[0] as {
    acme_user_id: string;
    acme_org_id: string;
    globex_ticket_id: string;
  };
}

async function run() {
  const ownerPool = new Pool({ connectionString: databaseUrl });
  const appPool = new Pool({ connectionString: appDatabaseUrl });
  const appClient = await appPool.connect();

  try {
    const role = await appPool.query(
      `
      SELECT current_user, rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
      `
    );
    const roleInfo = role.rows[0] as
      | { current_user: string; rolsuper: boolean; rolbypassrls: boolean }
      | undefined;

    if (!roleInfo) {
      throw new Error("Could not inspect current runtime role.");
    }
    if (roleInfo.rolsuper || roleInfo.rolbypassrls) {
      throw new Error(
        `Runtime role ${roleInfo.current_user} must not be superuser or BYPASSRLS.`
      );
    }

    const context = await getSeedContext(ownerPool);

    const noContext = await appPool.query("SELECT id FROM tickets LIMIT 1");
    if (noContext.rowCount !== 0) {
      throw new Error("Runtime app role can read tenant tickets without tenant context.");
    }

    await appClient.query("BEGIN");
    await appClient.query("SELECT set_config('app.current_user_id', $1, true)", [
      context.acme_user_id
    ]);

    const crossTenant = await appClient.query("SELECT id FROM tickets WHERE id = $1", [
      context.globex_ticket_id
    ]);
    if (crossTenant.rowCount !== 0) {
      throw new Error("Runtime app role read a cross-tenant ticket under Acme context.");
    }

    const currentOrg = await appClient.query("SELECT app_current_organization_id() AS organization_id");
    if (currentOrg.rows[0]?.organization_id !== context.acme_org_id) {
      throw new Error("Tenant context resolved to an unexpected organization.");
    }

    await appClient.query("ROLLBACK");
    console.log(
      `Runtime DB role verified: ${roleInfo.current_user} is non-superuser, has no BYPASSRLS, and RLS blocks missing/cross-tenant ticket reads.`
    );
  } finally {
    try {
      await appClient.query("ROLLBACK");
    } catch {
      // no-op: transaction may already be closed
    }
    appClient.release();
    await ownerPool.end();
    await appPool.end();
  }
}

run().catch((error) => {
  console.error("Runtime role verification failed:", error.message);
  process.exit(1);
});
