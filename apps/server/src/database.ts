import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";
import type { PoolClient } from "pg";

export function connectDatabase(connectionString: string) {
  return new Pool({ connectionString, max: 12, connectionTimeoutMillis: 5_000, statement_timeout: 8_000 });
}

export async function transaction<T>(db: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate(db: Pool): Promise<void> {
  const directory = new URL("../../../migrations/", import.meta.url);
  const migrations = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  await transaction(db, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(4327103)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const appliedNames = new Set(applied.rows.map(({ name }) => name));
    for (const name of migrations) {
      if (appliedNames.has(name)) continue;
      await client.query(await readFile(new URL(name, directory), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    }
  });
}
