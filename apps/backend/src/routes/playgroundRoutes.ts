import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { signAccessToken } from "../middleware/auth.js";

const router = Router();

const createTicketSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  subject: z.string().min(3),
  description: z.string().min(5),
  companySlug: z.string().min(2).optional()
});

router.post("/ticket", async (req, res) => {
  const parsed = createTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.issues });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orgSlug = parsed.data.companySlug ?? "acme";
    const org = await client.query(
      `
      SELECT id FROM organizations WHERE slug = $1 LIMIT 1
      `,
      [orgSlug]
    );
    if (org.rowCount !== 1) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Company not found. Use an existing company slug." });
    }

    const role = await client.query("SELECT id FROM roles WHERE key = 'customer' LIMIT 1");

    let user = await client.query(
      "SELECT id, organization_id, email FROM users WHERE email = $1 AND organization_id = $2 LIMIT 1",
      [parsed.data.email, org.rows[0].id]
    );

    if (user.rowCount !== 1) {
      const emailExistsElsewhere = await client.query(
        "SELECT organization_id FROM users WHERE email = $1 LIMIT 1",
        [parsed.data.email]
      );
      if (
        emailExistsElsewhere.rowCount === 1 &&
        emailExistsElsewhere.rows[0].organization_id !== org.rows[0].id
      ) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error:
            "This email already belongs to another company. Use a different email for playground or login with the existing account."
        });
      }

      const passwordHash = await bcrypt.hash("PlaygroundPass123!", 10);
      user = await client.query(
        `
        INSERT INTO users(organization_id, email, full_name, password_hash)
        VALUES($1, $2, $3, $4)
        RETURNING id, organization_id, email
        `,
        [org.rows[0].id, parsed.data.email, parsed.data.name, passwordHash]
      );
      await client.query(
        `
        INSERT INTO organization_memberships(organization_id, user_id, role_id)
        VALUES($1, $2, $3)
        ON CONFLICT (organization_id, user_id) DO NOTHING
        `,
        [org.rows[0].id, user.rows[0].id, role.rows[0].id]
      );
    }

    const ticket = await client.query(
      `
      INSERT INTO tickets(organization_id, requester_id, subject, description, status, priority)
      VALUES($1, $2, $3, $4, 'open', 'medium')
      RETURNING id, organization_id, requester_id, subject, description, status, priority, created_at, updated_at
      `,
      [org.rows[0].id, user.rows[0].id, parsed.data.subject, parsed.data.description]
    );

    await client.query("COMMIT");

    const token = signAccessToken({
      userId: user.rows[0].id,
      organizationId: user.rows[0].organization_id,
      role: "customer",
      email: user.rows[0].email
    });

    return res.status(201).json({ token, ticket: ticket.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    const pgError = error as { code?: string };
    if (pgError.code === "23505") {
      return res.status(409).json({
        error: "Email already exists. Use another email for playground."
      });
    }
    return res.status(400).json({ error: "Unable to create playground ticket" });
  } finally {
    client.release();
  }
});

export default router;
