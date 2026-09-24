import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { config } from "./config.js";
import { pool, query } from "./db.js";
import { createApp } from "./app.js";
import { setupRealtime } from "./realtime.js";
import { LATEST_SCHEMA_VERSION } from "./migrate.js";
import { startMediaCleanup } from "./media-cleanup.js";
export async function start(port = config.port) {
  const rows = await query(
    "SELECT version FROM schema_migrations WHERE version=?",
    [LATEST_SCHEMA_VERSION],
  );
  if (!rows.length)
    throw new Error(
      "Database upgrade required. Run npm run db:migrate before starting Message.",
    );
  await query(
    "UPDATE calls SET status='disconnected',ended_at=UTC_TIMESTAMP(3) WHERE ended_at IS NULL",
  );
  const io = new Server({
    maxHttpBufferSize: 16384,
    allowRequest: (req, cb) =>
      cb(
        null,
        req.headers.origin === config.origin ||
          (!req.headers.origin &&
            req.headers["sec-fetch-site"] === "same-origin"),
      ),
    cors: { origin: config.origin, credentials: true },
  });
  const server = createServer(await createApp(io));
  io.attach(server);
  const stopCleanup = setupRealtime(io);
  const stopMediaCleanup = startMediaCleanup();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "0.0.0.0", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await stopCleanup();
    await stopMediaCleanup();
    io.close();
    await pool.end();
    throw error;
  }
  return {
    server,
    io,
    close: async () => {
      await stopCleanup();
      await stopMediaCleanup();
      await new Promise((resolve) => io.close(resolve));
      await pool.end();
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let runtime;
  try {
    runtime = await start();
  } catch (error) {
    console.error("Message startup failed:", error.code || error.message);
    await pool.end().catch(() => {});
    process.exit(1);
  }
  console.log(`Message API listening on port ${config.port}`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      console.error("Graceful shutdown timed out");
      process.exit(1);
    }, 30000);
    deadline.unref();
    try {
      await runtime.close();
      process.exit(0);
    } catch (error) {
      console.error("Shutdown failed:", error.code || error.message);
      process.exit(1);
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
