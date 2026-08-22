import { Pool, types } from "pg";
import { env } from "../config/env.js";
import { requestContextStorage } from "../request-context.js";

// node-postgres returns NUMERIC/DECIMAL (OID 1700) as strings by default, to
// avoid silently losing precision on values that don't fit in a JS number.
// `price` is NUMERIC(10,2) and typed as `number` in Product — parse it here,
// once, globally, instead of every call site having to remember to cast.
types.setTypeParser(1700, (value: string) => parseFloat(value));

export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 10000,
    max: 10
});

export async function getClient() {
    const context = requestContextStorage.getStore();

    const start = performance.now();

    const client = await pool.connect();

    const elapsed = performance.now() - start;

    console.log({
        event: "db.connection_acquired",
        requestId: context?.requestId,
        durationMs: Number(elapsed.toFixed(2)),
        pool: {
            totalCount: pool.totalCount,
            idleCount: pool.idleCount,
            waitingCount: pool.waitingCount,
        },
    });

    return client;
}

pool.on("error", (err: Error) => {
    console.error("Unexpected error on idle client", err);

});