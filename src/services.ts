import type { Prisma, PrismaClient } from "@prisma/client";
import type { AnalysisResult, Bar, InstrumentDefinition, PatternConfig } from "./domain/types.js";
import { CompositeRegimeStrategy } from "./domain/strategy.js";
import { ProviderRegistry } from "./providers/index.js";

export class MarketService {
  constructor(private readonly db: PrismaClient, private readonly providers: ProviderRegistry, private readonly logger: Pick<Console, "info" | "warn">, private readonly strategy = new CompositeRegimeStrategy()) {}

  async addInstrument(definition: InstrumentDefinition) {
    return this.db.instrument.upsert({ where: { symbol: definition.symbol }, create: { ...definition, config: definition.config as unknown as Prisma.InputJsonValue }, update: { name: definition.name, kind: definition.kind, provider: definition.provider, providerSymbol: definition.providerSymbol, config: definition.config as unknown as Prisma.InputJsonValue } });
  }

  async importHistory(symbol: string, from?: Date, to?: Date): Promise<number> {
    const instrument = await this.requireInstrument(symbol);
    const { provider, providerSymbol } = this.resolveHistorySource(instrument.symbol, instrument.provider, instrument.providerSymbol);
    const bars = await provider.fetchHistory({ symbol: providerSymbol, interval: "1d", ...(from ? { from } : {}), ...(to ? { to } : {}) });
    if (bars.length === 0) return 0;
    await this.db.$transaction(bars.map((bar) => this.db.marketBar.upsert({ where: { instrumentId_timestamp_interval: { instrumentId: instrument.id, timestamp: bar.timestamp, interval: "1d" } }, create: { instrumentId: instrument.id, interval: "1d", source: provider.name, ...bar }, update: { source: provider.name, ...bar } })));
    this.logger.info({ symbol, count: bars.length, provider: provider.name }, "historical bars imported");
    return bars.length;
  }

  private resolveHistorySource(symbol: string, providerName: string, providerSymbol: string) {
    if (symbol.toUpperCase() === "VIX" && providerName === "stooq" && providerSymbol.toUpperCase() === "^VIX") {
      return { provider: this.providers.get("cboe"), providerSymbol: "VIX" };
    }
    return { provider: this.providers.get(providerName), providerSymbol };
  }

  async analyze(symbol: string): Promise<AnalysisResult> {
    const instrument = await this.requireInstrument(symbol);
    const rows = await this.db.marketBar.findMany({ where: { instrumentId: instrument.id, interval: "1d" }, orderBy: { timestamp: "asc" }, take: 1000 });
    const bars: Bar[] = rows.map((row) => ({ timestamp: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, ...(row.volume === null ? {} : { volume: row.volume }) }));
    const result = this.strategy.analyze(bars, instrument.config as unknown as PatternConfig);
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
    const rows = await this.db.marketBar.findMany({ where: { instrumentId: instrument.id }, orderBy: { timestamp: "asc" } });
    const bars = rows.map((row) => ({ timestamp: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, ...(row.volume === null ? {} : { volume: row.volume }) }));
    const config = instrument.config as unknown as PatternConfig;
    const minBars = Math.max(config.range.lookback, config.breakout.lookback + config.breakout.confirmationBars, config.meanReversion.lookback, config.trend.slowPeriod);
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

  private async requireInstrument(symbol: string) { const instrument = await this.db.instrument.findUnique({ where: { symbol: symbol.toUpperCase() } }); if (!instrument) throw new Error(`Instrument ${symbol} not found`); return instrument; }
}
