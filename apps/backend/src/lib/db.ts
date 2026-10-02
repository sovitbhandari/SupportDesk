import { Pool } from "pg";
import type { QueryResult, QueryResultRow } from "pg";
import { config } from "../config.js";
import type { AuthUser } from "./types.js";

export const pool = new Pool({ connectionString: config.databaseUrl });
export const appPool = new Pool({ connectionString: config.appDatabaseUrl });

export type TenantClient = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<R>>;
};

export async function withTenantTransaction<T>(
  auth: AuthUser,
  callback: (client: TenantClient) => Promise<T>
): Promise<T> {
  const client = await appPool.connect();
  let committed = false;

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [auth.userId]);

    const validated = await client.query(
      `
      SELECT 1
      FROM users u
      JOIN organization_memberships om
        ON om.user_id = u.id
        AND om.organization_id = u.organization_id
      JOIN roles r ON r.id = om.role_id
      WHERE u.id = $1
        AND u.organization_id = $2
        AND u.email = $3
        AND r.key = $4
        AND u.is_active = true
      LIMIT 1
      `,
      [auth.userId, auth.organizationId, auth.email, auth.role]
    );

    if (validated.rowCount !== 1) {
      throw new Error("Tenant context validation failed");
    }

    const result = await callback({
      query: <R extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: unknown[]
      ): Promise<QueryResult<R>> => client.query<R>(text, values)
    });
    await client.query("COMMIT");
    committed = true;
    return result;
  } finally {
    if (!committed) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original route/database error.
      }
    }
    client.release();
  }
}
