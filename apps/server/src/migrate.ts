import { connectDatabase, migrate } from "./database.js";

const connection = process.env.DATABASE_URL;
if (!connection) throw new Error("DATABASE_URL is required");

const db = connectDatabase(connection);
try {
  await migrate(db);
  console.log(JSON.stringify({ event: "migrations_applied" }));
} catch {
  console.error(JSON.stringify({ event: "migration_failed" }));
  process.exitCode = 1;
} finally {
  await db.end();
}
