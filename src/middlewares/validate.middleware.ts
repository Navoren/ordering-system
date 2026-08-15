import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";
import { BadRequestError } from "../errors.js";

/**
 * Parses & replaces req.body with the schema's output, or forwards a
 * BadRequestError (400) with the zod issue list on failure. Keeps validation
 * declared once, at the route, instead of re-implemented by hand in services.
 */
export function validateBody(schema: ZodType) {
    return (req: Request, _res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body);

        if (!result.success) {
            next(new BadRequestError("Invalid request body", result.error.issues));
            return;
        }

        req.body = result.data;
        next();
    };
}
