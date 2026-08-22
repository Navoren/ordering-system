import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { requestContextStorage, RequestContext } from '../request-context.js';

export function requestContextMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const requestId = crypto.randomUUID();
    
    requestContextStorage.run({ requestId } as RequestContext, () => {
        res.setHeader('X-Request-Id', requestId);
        next();
    });
}