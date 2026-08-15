import app from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/client.js";

const PORT = env.PORT || 3000;

const startServer = async () => {
    try {
        // pool.query() checks a client out and releases it back automatically —
        // pool.connect() alone would hold that client checked out for the
        // lifetime of the process, permanently shrinking the effective pool.
        await pool.query("SELECT 1");

        const server = app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });

        const shutdown = async () => {
            console.log("Shutting down...");
            server.close();
            await pool.end();
            process.exit(0);
        };

        process.on("SIGTERM", shutdown);
        process.on("SIGINT", shutdown);
    } catch (error) {
        console.error("Error starting server:", error);
        process.exit(1);
    }
};

startServer();
