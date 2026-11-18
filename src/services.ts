import { defaultPatternConfig } from "./config.js";
import { instrumentCsvFormats, lookupWatchlistKinds } from "./instrument-csv.js";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AnalysisResult, Bar, InstrumentDefinition, PatternConfig } from "./domain/types.js";
import { CompositeRegimeStrategy } from "./domain/strategy.js";
import type { HistoryInterval } from "./providers/provider.js";
import { ProviderRegistry } from "./providers/index.js";
import { resolveProviderSymbol } from "./providers/symbols.js";

export class MarketService {
  constructor(private readonly db: PrismaClient, private readonly providers: ProviderRegistry, private readonly logger: Pick<Console, "info" | "warn">, private readonly strategy = new CompositeRegimeStrategy()) {}

  async addInstrument(definition: InstrumentDefinition) {
    const providerSymbol = resolveProviderSymbol(definition);
    return this.db.instrument.upsert({ where: { symbol: definition.symbol }, create: { ...definition, providerSymbol, config: definition.config as unknown as Prisma.InputJsonValue }, update: { name: definition.name, kind: definition.kind, provider: definition.provider, providerSymbol, config: definition.config as unknown as Prisma.InputJsonValue } });
  }

  async importInstrumentCsv(provider: string, csv: string) {
    const format = instrumentCsvFormats.get(provider);
    if (!format || !this.providers.names().includes(provider)) {
      throw Object.assign(new Error("Select a configured provider with a supported CSV format"), { statusCode: 400 });
    }
    const entries = new Map<string, { symbol: string; name: string }>();
    for (const entry of format.parse(csv)) {
      if (!entries.has(entry.symbol)) entries.set(entry.symbol, entry);
    }
    const existing = await this.db.instrument.findMany({
      where: { symbol: { in: [...entries.keys()] } }, select: { symbol: true },
    });
    const existingSymbols = new Set(existing.map(({ symbol }) => symbol));
    const candidates = [...entries.values()].filter(({ symbol }) => !existingSymbols.has(symbol));
    const { kinds, incomplete } = candidates.length
      ? await lookupWatchlistKinds(candidates)
      : { kinds: new Map<string, never>(), incomplete: false };
    const data = candidates.flatMap((entry) => {
      const kind = kinds.get(entry.symbol);
      return kind ? [{
        ...entry, kind, provider, providerSymbol: entry.symbol,
        config: defaultPatternConfig as unknown as Prisma.InputJsonValue,
      }] : [];
    });
    const created = data.length ? await this.db.instrument.createManyAndReturn({
      data, skipDuplicates: true, select: { symbol: true, kind: true },
    }) : [];
    const createdSymbols = new Set(created.map(({ symbol }) => symbol));
    return {
      added: created,
      existing: [...entries.keys()].filter((symbol) => existingSymbols.has(symbol) ||
        (kinds.has(symbol) && !createdSymbols.has(symbol))),
      unresolved: candidates.filter(({ symbol }) => !kinds.has(symbol)).map(({ symbol }) => symbol),
      lookupIncomplete: incomplete,
    };
  }

  async importHistory(symbol: string, from?: Date, to?: Date): Promise<number> {
    const instrument = await this.requireInstrument(symbol);
    const provider = this.providers.get(instrument.provider);
    const bars = await provider.fetchHistory({ symbol: resolveProviderSymbol(instrument), interval: "1d", ...(from ? { from } : {}), ...(to ? { to } : {}) });
    if (bars.length === 0) return 0;
    await this.db.$transaction(bars.map((bar) => this.db.marketBar.upsert({ where: { instrumentId_timestamp_interval: { instrumentId: instrument.id, timestamp: bar.timestamp, interval: "1d" } }, create: { instrumentId: instrument.id, interval: "1d", source: provider.name, ...bar }, update: { source: provider.name, ...bar } })));
    this.logger.info({ symbol, count: bars.length, provider: provider.name }, "historical bars imported");
    return bars.length;
  }

  async downloadHistory(symbol: string, from?: Date, to?: Date, interval: HistoryInterval = "1d", requireSchwab = false) {
    const instrument = await this.requireInstrument(symbol);
    const schwabOnly = requireSchwab || interval !== "1d";
    if (schwabOnly && (instrument.provider !== "charles_schwab" || !this.providers.names().includes("charles_schwab"))) {
      throw Object.assign(new Error("Schwab market data is unavailable for this instrument"), { statusCode: 503 });
    }
    const provider = this.providers.get(instrument.provider);
    try {
      return await provider.fetchHistory({ symbol: resolveProviderSymbol(instrument), interval, ...(from ? { from } : {}), ...(to ? { to } : {}) });
    } catch (cause) {
      if (!schwabOnly) throw cause;
      throw Object.assign(new Error("Schwab price history request failed"), { statusCode: 502 });
    }
  }

  async getHistory(symbol: string, from?: Date, to?: Date) {
    const instrument = await this.requireInstrument(symbol);
    return this.db.marketBar.findMany({
      where: { instrumentId: instrument.id, interval: "1d", timestamp: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } },
      orderBy: { timestamp: "asc" },
      select: { timestamp: true, open: true, high: true, low: true, close: true, volume: true }
    });
  }

  async analyze(symbol: string): Promise<AnalysisResult> {
    const instrument = await this.requireInstrument(symbol);
    // Daily analysis deliberately excludes the current UTC date: providers
    // may return unfinished candles and do not expose a completion flag.
    const now = new Date();
    const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const rows = await this.db.marketBar.findMany({ where: { instrumentId: instrument.id, interval: "1d", timestamp: { lt: cutoff } }, orderBy: { timestamp: "desc" }, take: 1000 });
    // Select the newest window, then restore the chronological order detectors expect.
    rows.reverse();
    const bars: Bar[] = rows.map((row) => ({ timestamp: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, ...(row.volume === null ? {} : { volume: row.volume }) }));
    const result = this.strategy.analyze(bars, this.analysisConfig(instrument));
    const previous = await this.db.analysis.findFirst({ where: { instrumentId: instrument.id }, orderBy: { timestamp: "desc" } });
    await this.db.analysis.upsert({ where: { instrumentId_timestamp: { instrumentId: instrument.id, timestamp: result.timestamp } }, create: { instrumentId: instrument.id, timestamp: result.timestamp, regime: result.regime, score: result.score, confidence: result.confidence, evidence: result.evidence as unknown as Prisma.InputJsonValue, signals: result.signals as unknown as Prisma.InputJsonValue }, update: { regime: result.regime, score: result.score, confidence: result.confidence, evidence: result.evidence as unknown as Prisma.InputJsonValue, signals: result.signals as unknown as Prisma.InputJsonValue } });
    if (result.regime !== "INSUFFICIENT_DATA" && result.regime !== previous?.regime) await this.emitTransitionAlert(instrument.id, symbol, previous?.regime, result);
    return result;
  }

  private async emitTransitionAlert(instrumentId: string, symbol: string, fromRegime: string | undefined, result: AnalysisResult) {
    const dedupeKey = `${instrumentId}:${fromRegime ?? "INITIAL"}:${result.regime}:${result.timestamp.toISOString()}`;
    const severity = result.regime.startsWith("BREAKOUT") ? "WARNING" : result.regime.startsWith("TREND") ? "WATCH" : "INFO";
    const alert = await this.db.alert.upsert({ where: { dedupeKey }, create: { instrumentId, timestamp: result.timestamp, severity, type: "REGIME_TRANSITION", title: `${symbol} entered ${result.regime}`, message: `${symbol} changed from ${fromRegime ?? "unclassified"} to ${result.regime}`, fromRegime: fromRegime ?? null, toRegime: result.regime, score: result.score, confidence: result.confidence, evidence: result.evidence as unknown as Prisma.InputJsonValue, dedupeKey }, update: {} });
    this.logger.warn({ alertId: alert.id, symbol, fromRegime, toRegime: result.regime, score: result.score, confidence: result.confidence }, alert.message);
  }

  async backtest(symbol: string) {
    const instrument = await this.requireInstrument(symbol);
    const rows = await this.db.marketBar.findMany({ where: { instrumentId: instrument.id, interval: "1d", timestamp: { lt: new Date(new Date().toISOString().slice(0, 10)) } }, orderBy: { timestamp: "asc" } });
    const bars = rows.map((row) => ({ timestamp: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, ...(row.volume === null ? {} : { volume: row.volume }) }));
    const config = this.analysisConfig(instrument);
    const minBars = Math.max(config.range.lookback, config.breakout.lookback + config.breakout.confirmationBars, config.meanReversion.lookback, config.trend.slowPeriod, config.trend.slopePeriod);
    const observations = [];
    for (let i = minBars; i < bars.length - 1; i++) {
      const analysis = this.strategy.analyze(bars.slice(0, i + 1), config);
      const nextReturn = bars[i]!.close === 0 ? 0 : (bars[i + 1]!.close - bars[i]!.close) / bars[i]!.close;
      observations.push({ timestamp: bars[i]!.timestamp, regime: analysis.regime, score: analysis.score, nextReturn });
    }
    const grouped = new Map<string, typeof observations>();
    for (const item of observations) grouped.set(item.regime, [...(grouped.get(item.regime) ?? []), item]);
    const byRegime = [...grouped].map(([regime, items]) => ({ regime, observations: items.length, averageNextReturn: items.reduce((sum, item) => sum + item.nextReturn, 0) / items.length }));
    return { symbol, observations: observations.length, byRegime };
  }

  private analysisConfig(instrument: { config: unknown; kind: string }): PatternConfig {
    const config = instrument.config as PatternConfig;
    const volume = config.volume ?? { enabled: true, lookback: 20, lowRatio: 0.8, highRatio: 1.5 };
    return { ...config, volume: { ...volume, enabled: volume.enabled && ["ETF", "EQUITY"].includes(instrument.kind) } };
  }

  private async requireInstrument(symbol: string) { const instrument = await this.db.instrument.findUnique({ where: { symbol: symbol.toUpperCase() } }); if (!instrument) throw new Error(`Instrument ${symbol} not found`); return instrument; }
}
