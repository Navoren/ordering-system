import app from "./app";
import { env } from "./config/env";
import { pool } from "./db/client";

const PORT = env.PORT || 3000;

const startServer = async () => {
    try {
        await pool.connect();
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Error starting server:", error);
        process.exit(1);
    }
};

startServer();