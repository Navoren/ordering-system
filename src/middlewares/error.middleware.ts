import type { Request, Response, NextFunction } from "express"

export function errorMiddleware(
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
) { 
    console.error(error);

    const message = error instanceof Error ? error.message : "Internal Server Error";

    res.status(500).json({
        message,
    })
};