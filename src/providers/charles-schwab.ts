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
    const start = request.from ? dayStartUtc(request.from) : undefined;
    // Schwab rejects a zero-length window, and daily candles are stamped during the session, so the end is the next UTC midnight.
    const inclusiveEnd = request.to ? dayStartUtc(request.to) : undefined;
    const payload = await this.client.marketData.priceHistory.getPriceHistory({
      queryParams: {
        symbol: request.symbol,
        // Schwab defaults periodType to "day", which rejects daily frequency. "year" allows daily bars.
        periodType: "year",
        frequencyType: "daily",
        frequency: 1,
        ...(start !== undefined ? { startDate: start } : {}),
        ...(inclusiveEnd !== undefined ? { endDate: inclusiveEnd + dayMs } : {}),
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

    return bars
      .filter((bar) => {
        const day = dayStartUtc(bar.timestamp);
        return (start === undefined || day >= start) && (inclusiveEnd === undefined || day <= inclusiveEnd);
      })
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
}
