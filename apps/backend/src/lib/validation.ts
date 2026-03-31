import type { NextFunction, Request, Response } from "express";
import type { ZodError, ZodTypeAny } from "zod";

export function validate(source: "body" | "params" | "query", schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code
      }));
      return res.status(400).json({
        error: "ValidationError",
        source,
        details: issues
      });
    }
    ((req as unknown) as Record<string, unknown>)[source] = parsed.data;
    return next();
  };
}

export function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code
  }));
}
