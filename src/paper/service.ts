import { tradingRules, validateTradingRules } from "./rules.js";
import { Prisma, type PrismaClient } from "@prisma/client";
import { paperConfig, json, sessionDate, type PaperConfig } from "./config.js";
import { rebalance, positionsSchema, validateDecision, decisionSchema } from "./engine.js";
import { liveQuotes, sessionHours } from "./market.js";
import { requestDecision } from "./agent.js";
const D = Prisma.Decimal;
const policyHash = (config: PaperConfig) => JSON.stringify(config);
async function eligible(db: PrismaClient, config: PaperConfig) {
  const instruments = await db.instrument.findMany({ where: { symbol: { in: config.symbols } } });
  if (instruments.length !== config.symbols.length || instruments.some(i => !i.active || !["EQUITY", "ETF"].includes(i.kind))) throw new Error("Paper targets must be active registered EQUITY/ETF instruments");
  return instruments;
}
export async function previousSession(session: string) {
  const day = new Date(`${session}T12:00:00Z`);
  for (let n = 0; n < 10; n++) {
    day.setUTCDate(day.getUTCDate() - 1);
    const date = day.toISOString().slice(0, 10);
    if (await sessionHours(date)) return date;
  }
  throw new Error("Previous trading session unavailable");
}
export interface CollectedAnalysis { symbol: string; timestamp: Date }
export async function planPaperDay(db: PrismaClient, refreshed: CollectedAnalysis[]) {
  const config = paperConfig(); if (!config.enabled) return { status: "DISABLED" };
  const session = sessionDate();
  if (!await sessionHours(session)) return { status: "CLOSED" };
  const expected = await previousSession(session);
  const instruments = await eligible(db, config);
  // Require successful collection in this invocation, with the expected completed session.
  const snapshots = [];
  for (const instrument of instruments) {
    const fresh = refreshed.find(r => r.symbol === instrument.symbol && r.timestamp.toISOString().slice(0, 10) === expected);
    if (!fresh) throw new Error(`No successful ${expected} collection/analysis for ${instrument.symbol}; paper planning blocked`);
    const analysis = await db.analysis.findUnique({ where: { instrumentId_timestamp: { instrumentId: instrument.id, timestamp: fresh.timestamp } } });
    if (!analysis || analysis.regime === "INSUFFICIENT_DATA") throw new Error(`Usable analysis unavailable for ${instrument.symbol}`);
    const bar = await db.marketBar.findFirst({ where: { instrumentId: instrument.id, interval: "1d", timestamp: analysis.timestamp }, select: { close: true } });
    if (!bar || !Number.isFinite(bar.close) || bar.close <= 0) throw new Error("Analysis reference close unavailable");
    snapshots.push({ instrument, analysis, referenceClose: bar.close });
  }
  const account = await db.paperAccount.upsert({ where: { id: config.accountId }, update: {}, create: { id: config.accountId, initialCash: config.initialCash, cash: config.initialCash, positions: {}, benchmark: config.benchmark } });
  if (account.benchmark !== config.benchmark || !account.initialCash.eq(config.initialCash)) throw new Error("Initial cash or benchmark changed; use a new paper account ID");
  const inputs = json({ config, rules: tradingRules, snapshots, account, model: process.env.PAPER_AGENT_MODEL, capturedAt: new Date() });
  let run;
  try {
    run = await db.paperRun.create({ data: { accountId: config.accountId, session, strategy: config.strategy, status: "PLANNING", inputs, decision: {}, execution: {} } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "ALREADY_PLANNED" };
    throw error;
  }
  try {
    const decision = await requestDecision(inputs); validateDecision(decision, config);
    validateTradingRules(decision, config, snapshots, json(account));
    await db.paperRun.update({ where: { id: run.id }, data: { status: "READY", decision: json(decision) } });
    return { status: "READY", runId: run.id };
  } catch (error) {
    await db.paperRun.update({ where: { id: run.id }, data: { status: "FAILED", execution: { message: "Agent decision failed or violated policy; no execution permitted" } } });
    throw error;
  }
}
export async function executePaperDay(db: PrismaClient) {
  const config = paperConfig(); if (!config.enabled) return { status: "DISABLED" };
  const session = sessionDate(); const hours = await sessionHours(session);
  if (!hours) return { status: "CLOSED" };
  const key = { accountId: config.accountId, session, strategy: config.strategy };
  const run = await db.paperRun.findUnique({ where: { accountId_session_strategy: key } });
  if (!run || run.status !== "READY") return { status: "NO_READY_PLAN" };
  const inputs = run.inputs as { config?: unknown; rules?: unknown; snapshots?: unknown; account?: unknown };
  const { paperConfigSchema } = await import("./config.js");
  if (policyHash(paperConfigSchema.parse(inputs.config)) !== policyHash(config)) throw new Error("Paper policy changed since planning; execution blocked");
  const savedRules = (await import("./rules.js")).tradingRulesSchema.parse(inputs.rules);
  if (JSON.stringify(savedRules) !== JSON.stringify(tradingRules)) throw new Error("Trading rules changed since planning; execution blocked");
  validateTradingRules(decisionSchema.parse(run.decision), config, inputs.snapshots, inputs.account);
  await eligible(db, config);
  const quotes = await liveQuotes([...new Set([...config.symbols, config.benchmark])], config);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(79013202)`;
    const current = await tx.paperRun.findUniqueOrThrow({ where: { id: run.id } });
    if (current.status !== "READY") return { status: "ALREADY_EXECUTED" };
    const now = Date.now();
    if (sessionDate() !== session || now < Date.parse(hours.start) || now >= Date.parse(hours.end)) throw new Error("Paper execution requires an open regular equity session");
    for (const quote of Object.values(quotes)) if (now - quote.timestamp > config.maxQuoteAgeSeconds * 1000) throw new Error("Quote aged while awaiting account lock");
    const account = await tx.paperAccount.findUniqueOrThrow({ where: { id: config.accountId } });
    if (account.benchmark !== config.benchmark || !account.initialCash.eq(config.initialCash)) throw new Error("Paper account configuration mismatch");
    const executionSnapshots = (inputs.snapshots as Array<{ instrument: { symbol: string }; analysis: unknown }>).map(row => ({ ...row, referenceClose: new D(quotes[row.instrument.symbol]!.bid).plus(quotes[row.instrument.symbol]!.ask).div(2).toNumber() }));
    validateTradingRules(decisionSchema.parse(current.decision), config, executionSnapshots, json(account));
    const result = rebalance(account.cash.toString(), account.positions, quotes, decisionSchema.parse(current.decision), config);
    await tx.paperAccount.update({ where: { id: account.id }, data: { cash: result.cash, positions: json(result.positions),
      ...(account.benchmarkStartPrice === null ? { benchmarkStartPrice: new D(quotes[config.benchmark]!.bid).plus(quotes[config.benchmark]!.ask).div(2) } : {}) } });
    for (const fill of result.fills) await tx.paperFill.create({ data: { runId: run.id, ...fill } });
    await tx.paperRun.update({ where: { id: run.id }, data: { status: "EXECUTED", execution: json({ ...result, quotes, config, executedAt: new Date(), model: "BID_ASK_WITH_ADVERSE_SLIPPAGE", brokerOrderSubmitted: false }) } });
    return { status: "EXECUTED", runId: run.id, fills: result.fills.length };
  }, { timeout: 15000 });
}
export async function reportPaperDay(db: PrismaClient) {
  const config = paperConfig(); if (!config.enabled) return { status: "DISABLED" };
  const session = sessionDate(); const hours = await sessionHours(session);
  if (!hours) return { status: "CLOSED" };
  if (Date.now() < Date.parse(hours.end)) throw new Error("Daily report requires a completed regular session");
  const existing = await db.paperReport.findUnique({ where: { accountId_session: { accountId: config.accountId, session } } });
  if (existing) return existing;
  const instruments = await db.instrument.findMany({ where: { symbol: { in: [...new Set([...config.symbols, config.benchmark])] } } });
  const marks: Record<string, string> = {};
  for (const instrument of instruments) {
    const bar = await db.marketBar.findFirst({ where: { instrumentId: instrument.id, interval: "1d", timestamp: { gte: new Date(`${session}T00:00:00Z`), lt: new Date(new Date(`${session}T00:00:00Z`).getTime() + 86400000) } }, orderBy: { timestamp: "desc" } });
    if (bar && bar.close > 0 && Number.isFinite(bar.close)) marks[instrument.symbol] = String(bar.close);
  }
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(79013202)`;
    const account = await tx.paperAccount.findUniqueOrThrow({ where: { id: config.accountId } });
    const positions = positionsSchema.parse(account.positions);
    let equity = new D(account.cash); let unrealized = new D(0);
    for (const [symbol, p] of Object.entries(positions)) if (p.quantity) {
      const mark = marks[symbol]; if (!mark) throw new Error(`No completed-session closing mark for ${symbol}`);
      const value = new D(mark).mul(p.quantity); equity = equity.plus(value); unrealized = unrealized.plus(value.minus(p.costBasis));
    }
    const benchmarkMark = marks[config.benchmark]; if (!benchmarkMark) throw new Error("Benchmark closing mark unavailable");
    const fills = await tx.paperFill.findMany({ where: { runId: { in: (await tx.paperRun.findMany({ where: { accountId: config.accountId }, select: { id: true } })).map(r => r.id) } } });
    const fees = fills.reduce((sum, f) => sum.plus(f.fee), new D(0));
    const realized = equity.minus(account.initialCash).minus(unrealized);
    const benchmarkReturn = account.benchmarkStartPrice ? new D(benchmarkMark).div(account.benchmarkStartPrice).minus(1) : null;
    return tx.paperReport.upsert({ where: { accountId_session: { accountId: config.accountId, session } }, update: {}, create: { accountId: config.accountId, session,
      metrics: json({ cash: account.cash.toFixed(4), equity: equity.toFixed(4), realizedPnl: realized.toFixed(4), unrealizedPnl: unrealized.toFixed(4), fees: fees.toFixed(4), totalReturn: equity.div(account.initialCash).minus(1).toFixed(8), benchmark: config.benchmark, benchmarkReturn: benchmarkReturn?.toFixed(8) ?? null, positions, marks, simulated: true }) } });
  });
}
