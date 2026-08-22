import type { Request, Response, NextFunction } from "express";
import { requestContextStorage } from "../request-context.js";
import { recordRequestMetrics } from "../metrics/request.metrics.js";


export function requestLoggingMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const start = performance.now();
    

    res.on("finish", () => {
        const duration = performance.now() - start;
        const context = requestContextStorage.getStore();

        recordRequestMetrics(duration, res.statusCode);

        console.log(JSON.stringify({
            event: "request.completed",
            requestId: context?.requestId,
            method: req.method,
            route: req.originalUrl,
            statusCode: res.statusCode,
            duration: Number(duration).toFixed(2),
        }));
    });

    next();
}