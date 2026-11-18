import type { Bar } from "../domain/types.js";
import { createApiClient, EnhancedTokenManager, type SchwabApiClient, type TokenData } from "@sudowealth/schwab-api";
import type { HistoryRequest, MarketDataProvider } from "./provider.js";

type SchwabPriceHistoryApi = Readonly<{
  marketData: Readonly<{
    priceHistory: Readonly<{
      getPriceHistory: SchwabApiClient["marketData"]["priceHistory"]["getPriceHistory"];
    }>;
  }>;
}>;

export type SchwabProviderAuth = Readonly<{
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  onTokenUpdate?: (tokenData: TokenData) => void | Promise<void>;
}>;

type SchwabClientFactory = (authConfig: SchwabProviderAuth) => SchwabPriceHistoryApi;

const halfHourMs = 30 * 60 * 1000;
const hourMs = 2 * halfHourMs;
const dayMs = 24 * 60 * 60 * 1000;
const dayStartUtc = (date: Date): number => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

const toDate = (value: number | string | Date | null): Date | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return undefined;
};

export class CharlesSchwabProvider implements MarketDataProvider {
  readonly name = "charles_schwab";
  private readonly client: SchwabPriceHistoryApi;

  constructor(
    authConfig: SchwabProviderAuth,
    clientFactory: SchwabClientFactory = (config) => {
      let currentToken: TokenData = {
        accessToken: config.accessToken,
        ...(config.refreshToken ? { refreshToken: config.refreshToken } : {}),
      };
      const auth = new EnhancedTokenManager({
        clientId: config.clientId ?? "static-token",
        clientSecret: config.clientSecret ?? "static-token",
        redirectUri: config.redirectUri ?? "http://localhost",
        load: async () => currentToken,
        save: async (nextToken) => {
          currentToken = nextToken;
          await config.onTokenUpdate?.(nextToken);
        },
      });
      // The installed SDK returns an in-memory token without checking its expiry.
      // Check the actual saved expiry before every request, sharing one refresh.
      const getAccessToken = auth.getAccessToken.bind(auth);
      let pending: Promise<string | null> | undefined;
      auth.getAccessToken = () => {
        if (pending) return pending;
        pending = (async () => {
          if (currentToken.refreshToken && currentToken.expiresAt !== undefined && currentToken.expiresAt <= Date.now() + 120_000) {
            await auth.refreshIfNeeded({ force: true, refreshToken: currentToken.refreshToken });
          }
          return getAccessToken();
        })().finally(() => { pending = undefined; });
        return pending;
      };
      const client = createApiClient({ auth });
      return {
        marketData: {
          priceHistory: client.marketData.priceHistory,
        },
      };
    }
  ) {
    this.client = clientFactory(authConfig);
  }

  async fetchHistory(request: HistoryRequest): Promise<readonly Bar[]> {
    const daily = request.interval === "1d";
    const hourly = request.interval === "1h";
    const boundary = daily ? dayStartUtc : (date: Date) => date.getTime();
    const start = request.from ? boundary(request.from) : undefined;
    // Schwab rejects a zero-length window, and daily candles are stamped during the session, so the end is the next UTC midnight.
    const inclusiveEnd = request.to ? boundary(request.to) : undefined;
    const payload = await this.client.marketData.priceHistory.getPriceHistory({
      queryParams: {
        symbol: request.symbol,
        // Schwab defaults periodType to "day", which rejects daily frequency. "year" allows daily bars.
        ...(daily
          ? { periodType: "year", frequencyType: "daily", frequency: 1 } as const
          : { periodType: "day", frequencyType: "minute", frequency: hourly ? 30 : Number.parseInt(request.interval, 10),
              needExtendedHoursData: false, ...(start === undefined && inclusiveEnd === undefined ? { period: 1 } : {}) } as const),
        ...(start !== undefined ? { startDate: start } : {}),
        ...(inclusiveEnd !== undefined ? { endDate: inclusiveEnd + (daily ? dayMs : 0) } : {}),
      },
    });
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

    const candles = bars.filter((bar) => {
      const time = boundary(bar.timestamp);
      return (start === undefined || time >= start) && (inclusiveEnd === undefined || time <= inclusiveEnd);
    }).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return hourly ? aggregateHourly(candles) : candles;
  }
}

// Regular US equity sessions begin at 09:30 Eastern. The UTC offset changes
// with daylight saving time, but the half-hour alignment stays the same.
function aggregateHourly(bars: readonly Bar[]): Bar[] {
  const candles = new Map<number, Bar>();
  for (const bar of bars) {
    const time = bar.timestamp.getTime();
    const start = Math.floor((time - halfHourMs) / hourMs) * hourMs + halfHourMs;
    const current = candles.get(start);
    if (!current) {
      if (time === start) candles.set(start, bar);
      continue;
    }
    const volume = current.volume === undefined || bar.volume === undefined
      ? undefined : current.volume + bar.volume;
    candles.set(start, {
      timestamp: current.timestamp,
      open: current.open,
      high: Math.max(current.high, bar.high),
      low: Math.min(current.low, bar.low),
      close: bar.close,
      ...(volume === undefined ? {} : { volume }),
    });
  }
  return [...candles.values()];
}
