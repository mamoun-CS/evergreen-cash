import { Pool } from "pg";

let globalPool: Pool | null = null;

export function getDbUrl(): string {
  return (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.PRISMA_DATABASE_URL ||
    process.env.evergreencash_POSTGRES_URL ||
    process.env.evergreencash_DATABASE_URL ||
    process.env.evergreencash_PRISMA_DATABASE_URL ||
    ""
  );
}

export function getPool(): Pool {
  const connectionString = getDbUrl();
  if (!connectionString) {
    throw new Error("Postgres connection URL is not set in environment variables.");
  }

  if (!globalPool) {
    globalPool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false,
      },
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }

  return globalPool;
}

export async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const pool = getPool();
  const res = await pool.query(text, params);
  return res.rows as T[];
}

/**
 * Initializes the required tables in Postgres if they do not exist yet.
 */
export async function initPostgresTables(): Promise<void> {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS egc_sync_state (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      record_counts JSONB NOT NULL,
      checksum TEXT NOT NULL,
      data JSONB NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS egc_sync_history (
      id TEXT PRIMARY KEY,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      client_checksum TEXT,
      device_info TEXT
    );
  `);
}
