import { registerTradingRoutes } from "./trading/routes.js";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyError } from "fastify";
import { prisma } from "./db.js";
import { withStatus } from "./domain/status.js";
import { ProviderRegistry } from "./providers/index.js";
import { alertQuerySchema, historyQuerySchema, instrumentInputSchema, priceHistoryQuerySchema } from "./schemas.js";
import { MarketService } from "./services.js";
import { newInstrumentHtml } from "./web/new-instrument.js";
import { analysisHtml, uiHtml } from "./web/ui.js";

export function buildApp() {
  const app = Fastify({ logger: { redact: ["req.headers.authorization"], level: process.env.LOG_LEVEL ?? "info", ...(process.env.NODE_ENV === "production" ? {} : { transport: { target: "pino-pretty" } }) } });
  void app.register(sensible);
  registerTradingRoutes(app, prisma);
  const providers = new ProviderRegistry();
  const service = new MarketService(prisma, providers, app.log);
  const newInstrumentPage = newInstrumentHtml(providers.names());
  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(uiHtml));
  app.get("/analysis", async (_request, reply) => reply.type("text/html; charset=utf-8").send(analysisHtml));
  app.get("/api/v1/analyses/latest", async () => {
    const instruments = await prisma.instrument.findMany({
      orderBy: { symbol: "asc" },
      include: { analyses: { orderBy: { timestamp: "desc" }, take: 1 } },
    });
    return instruments.map(({ analyses, symbol, name }) => ({ symbol, name, analysis: analyses[0] ? withStatus(analyses[0]) : null }));
  });
  app.get("/instruments/new", async (_request, reply) => reply.type("text/html; charset=utf-8").send(newInstrumentPage));
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/api/v1/auth/token-status", async () => providers.tokenStatus());
  app.get("/api/v1/instruments", async () => prisma.instrument.findMany({ orderBy: { symbol: "asc" } }));
  app.post("/api/v1/instruments", async (request, reply) => reply.code(201).send(await service.addInstrument(instrumentInputSchema.parse(request.body))));
  app.post("/api/v1/instruments/:symbol/import", async (request) => { const { symbol } = request.params as { symbol: string }; const query = historyQuerySchema.parse(request.query); return { imported: await service.importHistory(symbol, query.from, query.to) }; });
  app.get("/api/v1/instruments/:symbol/pricehistory", async (request) => { const { symbol } = request.params as { symbol: string }; const query = priceHistoryQuerySchema.parse(request.query); return service.downloadHistory(symbol, query.from, query.to); });
  app.get("/api/v1/instruments/:symbol/data", async (request) => { const { symbol } = request.params as { symbol: string }; return prisma.marketBar.findMany({ where: { instrument: { symbol: symbol.toUpperCase() } }, orderBy: { timestamp: "desc" }, take: 500 }); });
  app.post("/api/v1/instruments/:symbol/analyze", async (request) => withStatus(await service.analyze((request.params as { symbol: string }).symbol)));
  app.get("/api/v1/instruments/:symbol/analysis", async (request) => { const analysis = await prisma.analysis.findFirst({ where: { instrument: { symbol: (request.params as { symbol: string }).symbol.toUpperCase() } }, orderBy: { timestamp: "desc" } }); return analysis ? withStatus(analysis) : null; });
  app.get("/api/v1/signals/:symbol", async (request) => { const analysis = await prisma.analysis.findFirst({ where: { instrument: { symbol: (request.params as { symbol: string }).symbol.toUpperCase() } }, orderBy: { timestamp: "desc" }, select: { timestamp: true, regime: true, score: true, confidence: true, signals: true } }); return analysis ?? app.httpErrors.notFound("No analysis found"); });
  app.get("/api/v1/alerts", async (request) => { const query = alertQuerySchema.parse(request.query); return prisma.alert.findMany({ where: { ...(query.symbol ? { instrument: { symbol: query.symbol.toUpperCase() } } : {}), ...(query.severity ? { severity: query.severity } : {}) }, include: { instrument: { select: { symbol: true } } }, orderBy: { timestamp: "desc" }, take: query.limit }); });
  app.get("/api/v1/instruments/:symbol/backtest", async (request) => service.backtest((request.params as { symbol: string }).symbol));
  app.setErrorHandler((error: FastifyError, _request, reply) => { const status = error.name === "ZodError" ? 400 : error.message.includes("not found") ? 404 : error.statusCode ?? 500; void reply.code(status).send({ error: error.name, message: error.message }); });
  app.addHook("onClose", async () => prisma.$disconnect());
  return app;
}
