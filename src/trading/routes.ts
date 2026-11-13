import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { notionalUnits, policySchema, proposalSchema, validatePolicy } from "./policy.js";
import { readSchwab } from "./schwab.js";

const agentSchema = z.array(z.object({
  id: z.string().min(1), token: z.string().min(32),
  scopes: z.array(z.enum(["analysis:read", "portfolio:read", "trades:propose"])),
}).strict()).refine(agents => new Set(agents.map(a => a.id)).size === agents.length && new Set(agents.map(a => a.token)).size === agents.length, "Agent IDs and tokens must be unique");
const digest = (s: string) => createHash("sha256").update(s).digest();
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const error = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

export function registerTradingRoutes(app: FastifyInstance, db: PrismaClient) {
  // Configuration is optional; missing configuration denies all agent access.
  const agents = agentSchema.parse(JSON.parse(process.env.AGENT_CREDENTIALS_JSON ?? "[]"));
  const policy = policySchema.parse(JSON.parse(process.env.TRADING_POLICY_JSON ?? JSON.stringify({
    version: "paper-v1", enabled: false, allowedSymbols: ["SPY"], maxOrderDollars: 1000,
    maxDailyDollars: 5000, maxAnalysisAgeHours: 96,
  })));
  app.register(async routes => {
    routes.addHook("onRequest", async (request, reply) => {
      const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? "";
      const agent = agents.find(a => timingSafeEqual(digest(a.token), digest(token)));
      if (!agent) return reply.code(401).send({ error: "Agent authentication required" });
      const scope = request.url.startsWith("/api/v1/agent/portfolio/") ? "portfolio:read"
        : request.url.startsWith("/api/v1/agent/context") ? "analysis:read" : "trades:propose";
      if (!agent.scopes.includes(scope)) return reply.code(403).send({ error: "Agent scope required", scope });
      request.agentId = agent.id;
    });
    routes.get("/api/v1/agent/context", async () => ({
      mode: "SIMULATION", policy,
      analyses: await db.analysis.findMany({ orderBy: { timestamp: "desc" }, take: 100,
        include: { instrument: { select: { symbol: true, kind: true } } } }),
    }));
    routes.get("/api/v1/agent/portfolio/accounts", async () => readSchwab("accounts"));
    routes.get("/api/v1/agent/portfolio/orders", async () => readSchwab("orders"));
    routes.get("/api/v1/trade-proposals/:id", async request => {
      const { id } = request.params as { id: string };
      const proposal = await db.tradeProposal.findFirst({ where: { id, agentId: request.agentId! } });
      if (!proposal) throw error("Proposal not found", 404);
      return proposal;
    });
    routes.post("/api/v1/trade-proposals", async (request, reply) => {
      const input = proposalSchema.parse(request.body);
      const agentId = request.agentId!;
      const requestHash = digest(JSON.stringify(input)).toString("hex");
      // Serializable transactions plus a shared advisory lock serialize budget reservation
      // across all API replicas. No external broker request is made inside this transaction.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await db.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(79013201)`;
            const existing = await tx.tradeProposal.findUnique({ where: { agentId_idempotencyKey: { agentId, idempotencyKey: input.idempotencyKey } } });
            if (existing) {
              if (existing.requestHash !== requestHash) throw error("Idempotency key already used with different request", 409);
              return { proposal: existing, created: false };
            }
            const tradingInstrument = await tx.instrument.findUnique({ where: { symbol: input.symbol } });
            if (!tradingInstrument || !["EQUITY", "ETF"].includes(tradingInstrument.kind)) {
              throw error("Trading symbol must be a configured EQUITY or ETF instrument", 422);
            }
            const analysis = await tx.analysis.findUnique({ where: { id: input.analysisId }, include: { instrument: true } });
            if (!analysis) throw error("Analysis not found", 404);
            try { validatePolicy(input, policy, analysis.timestamp); }
            catch (e) { throw error((e as Error).message, 422); }
            // Daily budget uses UTC explicitly and includes every agent's simulations.
            const today = new Date(); today.setUTCHours(0, 0, 0, 0);
            const prior = await tx.tradeProposal.findMany({ where: { createdAt: { gte: today } }, select: { quantity: true, limitPrice: true } });
            const used = prior.reduce((total, p) => total.plus(p.limitPrice.mul(p.quantity)), new Prisma.Decimal(0));
            const cost = new Prisma.Decimal(input.limitPrice).mul(input.quantity);
            if (used.plus(cost).gt(policy.maxDailyDollars)) throw error("Daily simulation budget exceeded", 422);
            const proposal = await tx.tradeProposal.create({ data: {
              agentId, idempotencyKey: input.idempotencyKey, requestHash, status: "SIMULATED",
              symbol: input.symbol, quantity: input.quantity, limitPrice: input.limitPrice,
              snapshot: json({ capturedAt: new Date(), analysis, tradingInstrument }), policy: json(policy), request: json(input),
              simulation: { assumedPrice: input.limitPrice, notional: cost.toFixed(4), notionalUnits: notionalUnits(input),
                model: "LIMIT_PRICE_ASSUMPTION", brokerOrderSubmitted: false,
                warning: "Hypothetical execution at submitted limit; no quote, liquidity, fees, buying power or fill validation. Not a portfolio ledger." },
            } });
            await tx.tradingAuditEvent.create({ data: { agentId, proposalId: proposal.id, event: "PROPOSAL_SIMULATED", details: { requestHash, policyVersion: policy.version } } });
            return { proposal, created: true };
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
          return reply.code(result.created ? 201 : 200).send(result.proposal);
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(e.code)) {
            if (attempt < 2) continue;
            throw error("Concurrent proposal conflict; retry with the same idempotency key", 409);
          }
          throw e;
        }
      }
    });
  });
}

declare module "fastify" { interface FastifyRequest { agentId?: string } }
