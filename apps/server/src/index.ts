import { loadActiveDefinition } from "../../../packages/config/src/index.js";
import { connectDatabase } from "./database.js";
import { startServer } from "./http.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const origin = new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:4173");
  if (!["http:", "https:"].includes(origin.protocol) || origin.href !== `${origin.origin}/`) {
    throw new Error("APP_ORIGIN must be a single HTTP(S) origin");
  }
  const port = Number(process.env.PORT ?? "4174");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a TCP port");
  const host = process.env.HOST ?? "127.0.0.1";
  const definition = await loadActiveDefinition();
  const db = connectDatabase(databaseUrl);
  db.on("error", () => console.error(JSON.stringify({ event: "database_connection_lost" })));

  try {
    await db.query("SELECT 1 FROM rooms LIMIT 0");
    const server = await startServer({ db, definition, origin: origin.origin, playtest: process.env.PLAYTEST_MODE === "1", host, port });
    console.log(JSON.stringify({ event: "server_listening", host, port: server.port }));
    const shutdown = () => {
      void server.close().then(() => db.end()).then(
        () => console.log(JSON.stringify({ event: "server_stopped" })),
        () => {
          console.error(JSON.stringify({ event: "shutdown_failed" }));
          process.exitCode = 1;
        });
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  } catch {
    await db.end();
    throw new Error("Server startup failed. Verify the database is reachable and pnpm migrate has been run.");
  }
}

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({ event: "startup_failed", message: error instanceof Error ? error.message : "Server startup failed" }));
  process.exitCode = 1;
}
