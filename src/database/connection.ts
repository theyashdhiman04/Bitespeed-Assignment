import path from "path";
import fs from "fs";
import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";

let connection: Database | null = null;

function resolveDbPath(): string {
    const url = process.env.DATABASE_URL ?? "file:./dev.db";

    if (!url.startsWith("file:")) {
        throw new Error(
            "DATABASE_URL must follow the sqlite file: format, e.g. file:./dev.db"
        );
    }

    const relative = url.replace(/^file:/, "");
    return path.resolve(process.cwd(), relative);
}

export async function getConnection(): Promise<Database> {
    if (connection) return connection;

    const dbPath = resolveDbPath();

    // Ensure the directory tree exists (important for container deploys).
    try {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    } catch (err) {
        throw new Error(
            `Cannot prepare database directory at ${dbPath}. Verify DATABASE_URL and disk permissions. ${err instanceof Error ? err.message : ""
            }`
        );
    }

    connection = await open({
        filename: dbPath,
        driver: sqlite3.Database,
    });

    return connection;
}

export async function setupDatabase(): Promise<void> {
    const db = await getConnection();

    await db.exec(`
    CREATE TABLE IF NOT EXISTS Contact (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      phoneNumber   TEXT,
      email         TEXT,
      linkedId      INTEGER,
      linkPrecedence TEXT NOT NULL,
      createdAt     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deletedAt     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_email   ON Contact(email);
    CREATE INDEX IF NOT EXISTS idx_phone   ON Contact(phoneNumber);
    CREATE INDEX IF NOT EXISTS idx_linked  ON Contact(linkedId);
  `);
}

export async function teardownDatabase(): Promise<void> {
    if (!connection) return;
    await connection.close();
    connection = null;
}
