import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { config } from "./config.js";
import { pool, query } from "./db.js";
import { createApp } from "./app.js";
import { setupRealtime } from "./realtime.js";
export async function start(port = config.port) {
  await query("SELECT version FROM schema_migrations WHERE version=1");
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
  await new Promise((resolve) => server.listen(port, "0.0.0.0", resolve));
  return {
    server,
    io,
    close: async () => {
      stopCleanup();
      await new Promise((resolve) => io.close(resolve));
      await pool.end();
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runtime = await start();
  console.log(`Message API listening on port ${config.port}`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await runtime.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
