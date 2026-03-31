import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../lib/db.js";
import { config } from "../config.js";
import type { AuthUser, AuthedRequest, UserRole } from "../lib/types.js";

type JwtPayload = {
  sub: string;
  organizationId: string;
  role: UserRole;
  email: string;
};

async function userStillValid(payload: JwtPayload): Promise<boolean> {
  const result = await pool.query(
    `
    SELECT 1
    FROM users u
    JOIN organization_memberships om ON om.user_id = u.id
    JOIN roles r ON r.id = om.role_id
    WHERE u.id = $1
      AND u.organization_id = $2
      AND u.email = $3
      AND r.key = $4
      AND u.is_active = true
    LIMIT 1
    `,
    [payload.sub, payload.organizationId, payload.email, payload.role]
  );

  return result.rowCount === 1;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.slice("Bearer ".length);

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    const valid = await userStillValid(decoded);
    if (!valid) {
      return res.status(401).json({ error: "Token no longer valid for this user" });
    }

    const authUser: AuthUser = {
      userId: decoded.sub,
      organizationId: decoded.organizationId,
      role: decoded.role,
      email: decoded.email
    };
    req.auth = authUser;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function signToken(user: AuthUser) {
  return jwt.sign(
    {
      sub: user.userId,
      organizationId: user.organizationId,
      role: user.role,
      email: user.email
    },
    config.jwtSecret as jwt.Secret,
    { expiresIn: config.jwtExpiresIn }
  );
}
