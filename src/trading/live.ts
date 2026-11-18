import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { liveOrderConfig, liveOrderSchema } from "./policy.js";
import { submitSchwabOrder } from "./schwab.js";
import { tradeAccessToken } from "./token.js";

const receipt = { id: true, status: true, brokerOrderId: true, createdAt: true } as const;

export function registerLiveOrderRoutes(routes: FastifyInstance, db: PrismaClient, config: ReturnType<typeof liveOrderConfig>) {
  routes.get("/api/v1/agent/live-orders/permission", async () => config ? {
    enabled: true,
    maxOrderDollars: config.maxOrderDollars,
    maxDailyDollars: config.maxDailyDollars,
  } : { enabled: false });
  routes.post("/api/v1/agent/live-orders", async (request, reply) => {
    if (!config) return reply.code(403).send({ error: "Agent live trading is disabled" });
    const input = liveOrderSchema.parse(request.body);
    const agentId = request.agentId!;
    const key = { agentId, idempotencyKey: input.idempotencyKey };
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const notional = new Prisma.Decimal(input.limitPrice).mul(input.quantity);

    const reservation = await db.$transaction(async tx => {
      // Read committed gives the budget query a fresh snapshot after acquiring the lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(79013203)`;
      const existing = await tx.liveOrder.findUnique({
        where: { agentId_idempotencyKey: key }, select: { ...receipt, requestHash: true },
      });
      if (existing) {
        const { requestHash: savedHash, ...order } = existing;
        if (savedHash !== requestHash) return { code: 409, error: "Idempotency key already used" } as const;
        return { order, created: false } as const;
      }
      if (notional.gt(config.maxOrderDollars)) {
        return { code: 422, error: "Order exceeds the live per-order limit" } as const;
      }
      const instrument = await tx.instrument.findUnique({ where: { symbol: input.symbol } });
      if (!instrument?.active || !["EQUITY", "ETF"].includes(instrument.kind)) {
        return { code: 422, error: "Live targets must be active registered equities or ETFs" } as const;
      }
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const used = await tx.liveOrder.aggregate({
        where: { createdAt: { gte: today }, status: { not: "REJECTED" } }, _sum: { notional: true },
      });
      if ((used._sum.notional ?? new Prisma.Decimal(0)).plus(notional).gt(config.maxDailyDollars)) {
        return { code: 422, error: "Daily live order budget exceeded" } as const;
      }
      // Commit before contacting Schwab. A crash leaves a record that prevents resubmission.
      const order = await tx.liveOrder.create({
        data: { ...key, requestHash, status: "PENDING", request: input, notional }, select: receipt,
      });
      return { order, created: true } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    if (reservation.code !== undefined) return reply.code(reservation.code).send({ error: reservation.error });
    if (!reservation.created) return reservation.order;

    const token = await tradeAccessToken().catch(() => undefined);
    const outcome = token
      ? await submitSchwabOrder(token, config.accountHash, input).catch(() => ({ status: "UNKNOWN" }))
      : { status: "REJECTED" };
    const order = await db.liveOrder.update({ where: { id: reservation.order.id }, data: outcome, select: receipt });
    return reply.code(201).send(order);
  });
}
