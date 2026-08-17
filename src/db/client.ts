import { Pool, types } from "pg";
import { env } from "../config/env.js";

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

pool.on("error", (err: Error) => {
    console.error("Unexpected error on idle client", err);

});