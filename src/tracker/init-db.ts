import * as sqlite3 from "sqlite3";
import { open } from "sqlite";
import { config } from "../config";

// Script to initialize the database and create necessary tables
export async function initializeDatabase(): Promise<void> {
    try {
        console.log("Initializing database...");

        // Open the database (this will create the file if it doesn't exist)
        const db = await open({
            filename: config.db.pathname,
            driver: sqlite3.Database,
        });

        console.log(`Database created/opened at: ${config.db.pathname}`);

        // Create the tokens table
        await db.exec(`
            CREATE TABLE IF NOT EXISTS tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                time INTEGER NOT NULL,
                name TEXT NOT NULL,
                mint TEXT NOT NULL,
                creator TEXT NOT NULL
            );
        `);

        console.log("Tokens table created successfully");

        // Create an index for better performance on common queries
        await db.exec(`
            CREATE INDEX IF NOT EXISTS idx_tokens_name ON tokens(name);
            CREATE INDEX IF NOT EXISTS idx_tokens_mint ON tokens(mint);
            CREATE INDEX IF NOT EXISTS idx_tokens_creator ON tokens(creator);
        `);

        console.log("Database indexes created successfully");

        await db.close();
        console.log("Database initialization completed successfully");

    } catch (error) {
        console.error("Error initializing database:", error);
        throw error;
    }
}

// Run the initialization if this script is executed directly
if (require.main === module) {
    initializeDatabase()
        .then(() => {
            console.log("Database setup complete");
            process.exit(0);
        })
        .catch((error) => {
            console.error("Database setup failed:", error);
            process.exit(1);
        });
}
