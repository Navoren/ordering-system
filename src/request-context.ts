import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContext = {
    requestId: string;
};

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();