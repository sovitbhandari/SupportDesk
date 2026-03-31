import type { NextFunction, Response } from "express";
import type { AuthedRequest, UserRole } from "../lib/types.js";

export function allowRoles(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({
        error: "Forbidden",
        requiredRoles: roles,
        currentRole: req.auth.role
      });
    }

    return next();
  };
}
