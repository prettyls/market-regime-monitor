import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./config.js";

const config = env();
const app = buildApp();
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app.close().catch((error: unknown) => {
      app.log.error(error);
      process.exitCode = 1;
    });
  });
}
try { await app.listen({ port: config.PORT, host: config.HOST }); }
catch (error) { app.log.error(error); process.exit(1); }
