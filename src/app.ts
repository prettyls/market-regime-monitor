import sensible from "@fastify/sensible";
import Fastify, { type FastifyError } from "fastify";
import { prisma } from "./db.js";
import { ProviderRegistry } from "./providers/index.js";
import { alertQuerySchema, historyQuerySchema, instrumentInputSchema, priceHistoryQuerySchema } from "./schemas.js";
import { MarketService } from "./services.js";

export function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info", ...(process.env.NODE_ENV === "production" ? {} : { transport: { target: "pino-pretty" } }) } });
  void app.register(sensible);
  const service = new MarketService(prisma, new ProviderRegistry(), app.log);
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/api/v1/instruments", async () => prisma.instrument.findMany({ orderBy: { symbol: "asc" } }));
  app.post("/api/v1/instruments", async (request, reply) => reply.code(201).send(await service.addInstrument(instrumentInputSchema.parse(request.body))));
  app.post("/api/v1/instruments/:symbol/import", async (request) => { const { symbol } = request.params as { symbol: string }; const query = historyQuerySchema.parse(request.query); return { imported: await service.importHistory(symbol, query.from, query.to) }; });
  app.get("/api/v1/instruments/:symbol/pricehistory", async (request) => { const { symbol } = request.params as { symbol: string }; const query = priceHistoryQuerySchema.parse(request.query); return service.downloadHistory(symbol, query.from, query.to); });
  app.get("/api/v1/instruments/:symbol/data", async (request) => { const { symbol } = request.params as { symbol: string }; return prisma.marketBar.findMany({ where: { instrument: { symbol: symbol.toUpperCase() } }, orderBy: { timestamp: "desc" }, take: 500 }); });
  app.post("/api/v1/instruments/:symbol/analyze", async (request) => service.analyze((request.params as { symbol: string }).symbol));
  app.get("/api/v1/instruments/:symbol/analysis", async (request) => prisma.analysis.findFirst({ where: { instrument: { symbol: (request.params as { symbol: string }).symbol.toUpperCase() } }, orderBy: { timestamp: "desc" } }));
  app.get("/api/v1/signals/:symbol", async (request) => { const analysis = await prisma.analysis.findFirst({ where: { instrument: { symbol: (request.params as { symbol: string }).symbol.toUpperCase() } }, orderBy: { timestamp: "desc" }, select: { timestamp: true, regime: true, score: true, confidence: true, signals: true } }); return analysis ?? app.httpErrors.notFound("No analysis found"); });
  app.get("/api/v1/alerts", async (request) => { const query = alertQuerySchema.parse(request.query); return prisma.alert.findMany({ where: { ...(query.symbol ? { instrument: { symbol: query.symbol.toUpperCase() } } : {}), ...(query.severity ? { severity: query.severity } : {}) }, include: { instrument: { select: { symbol: true } } }, orderBy: { timestamp: "desc" }, take: query.limit }); });
  app.get("/api/v1/instruments/:symbol/backtest", async (request) => service.backtest((request.params as { symbol: string }).symbol));
  app.setErrorHandler((error: FastifyError, _request, reply) => { const status = error.name === "ZodError" ? 400 : error.message.includes("not found") ? 404 : error.statusCode ?? 500; void reply.code(status).send({ error: error.name, message: error.message }); });
  app.addHook("onClose", async () => prisma.$disconnect());
  return app;
}
