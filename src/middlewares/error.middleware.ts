import type { Request, Response, NextFunction } from "express"
import { AppError } from "../errors.js";

export function errorMiddleware(
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
) {
    console.error(error);

    if (error instanceof AppError) {
        res.status(error.statusCode).json({
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
        });
        return;
    }

    // Unexpected errors (DB driver errors, bugs, etc.) are logged above with full
    // detail but not echoed to the client — don't leak internals over the wire.
    res.status(500).json({
        message: "Internal Server Error",
    })
};
