import { buildApp } from "./app.js";
import { env } from "./config.js";

const config = env();
const app = buildApp();
try { await app.listen({ port: config.PORT, host: config.HOST }); }
catch (error) { app.log.error(error); process.exit(1); }
