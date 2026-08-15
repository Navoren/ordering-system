import { Pool } from "pg";
import { env } from "../config/env";

export const pool = new Pool({
    connectionString: env.DATABASE_URL
});

pool.on("error", (err: Error) => {
    console.error("Unexpected error on idle client", err);

});