import type { Bar } from "../domain/types.js";
import { RestRequestFactory } from "../rest/request-factory.js";
import type { HistoryRequest, MarketDataProvider } from "./provider.js";

type SchwabCandle = Readonly<{
  datetime: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}>;

type SchwabPriceHistoryResponse = Readonly<{
  candles?: readonly SchwabCandle[];
}>;

const dayStartUtc = (date: Date): number => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

const toDate = (value: number | string): Date | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return undefined;
};

export class CharlesSchwabProvider implements MarketDataProvider {
  readonly name = "charles_schwab";

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly requestFactory: RestRequestFactory
  ) {}

  async fetchHistory(request: HistoryRequest): Promise<readonly Bar[]> {
    const params = new URLSearchParams({
      symbol: request.symbol,
      interval: request.interval,
      ...(request.from ? { startDate: String(dayStartUtc(request.from)) } : {}),
      ...(request.to ? { endDate: String(dayStartUtc(request.to)) } : {}),
    });
    const path = `/marketdata/v1/pricehistory?${params.toString()}`;
    const response = await this.fetcher(this.requestFactory.create({ method: "GET", path }));
    if (!response.ok) throw new Error(`charles_schwab returned HTTP ${response.status} for ${request.symbol}`);

    const payload = (await response.json()) as SchwabPriceHistoryResponse;
    const bars = (payload.candles ?? [])
      .map((candle) => {
        const timestamp = toDate(candle.datetime);
        if (!timestamp) return undefined;
        return {
          timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          ...(candle.volume === undefined ? {} : { volume: candle.volume }),
        };
      })
      .filter((bar): bar is Bar => {
        if (!bar) return false;
        const values = [bar.open, bar.high, bar.low, bar.close, ...(bar.volume === undefined ? [] : [bar.volume])];
        return values.every((value) => Number.isFinite(value));
      });

    return bars.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
}
