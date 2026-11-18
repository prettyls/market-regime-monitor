import { afterEach, describe, expect, it, vi } from "vitest";
import { CharlesSchwabProvider } from "../src/providers/charles-schwab.js";
import { ProviderRegistry } from "../src/providers/index.js";
import { PropositionMapping } from "../src/providers/proposition-mapping.js";

describe("CharlesSchwabProvider", () => {
  it("fetches and normalizes price history candles", async () => {
    const getPriceHistory = vi.fn().mockResolvedValue({
      candles: [
        { datetime: 1704240000000, open: 13, high: 15, low: 12, close: 14, volume: 1200 },
        { datetime: 1704153600000, open: 12, high: 14, low: 11, close: 13, volume: 1000 },
      ],
    });
    const provider = new CharlesSchwabProvider({ accessToken: "test-token" }, () => ({
      marketData: {
        priceHistory: {
          getPriceHistory,
        },
      },
    }));

    const result = await provider.fetchHistory({ symbol: "$VIX", interval: "1d" });

    expect(getPriceHistory).toHaveBeenCalledOnce();
    expect(getPriceHistory).toHaveBeenCalledWith({
      queryParams: expect.objectContaining({
        symbol: "$VIX",
        periodType: "year",
        frequencyType: "daily",
        frequency: 1,
      }),
    });
    expect(result).toHaveLength(2);
    expect(result[0]?.close).toBe(13);
  });

  it("requests five-minute candles with exact timestamp bounds", async () => {
    const from = new Date("2026-11-06T14:30:00Z");
    const to = new Date("2026-11-06T14:40:00Z");
    const candle = { datetime: from.getTime(), open: 13, high: 15, low: 12, close: 14 };
    const getPriceHistory = vi.fn().mockResolvedValue({
      candles: [candle, { ...candle, datetime: from.getTime() - 300_000 }],
    });
    const provider = new CharlesSchwabProvider({ accessToken: "test-token" }, () => ({
      marketData: { priceHistory: { getPriceHistory } },
    }));

    const bars = await provider.fetchHistory({ symbol: "SPY", interval: "5m", from, to });

    expect(getPriceHistory).toHaveBeenCalledWith({ queryParams: {
      symbol: "SPY", periodType: "day", frequencyType: "minute", frequency: 5,
      needExtendedHoursData: false, startDate: from.getTime(), endDate: to.getTime(),
    } });
    expect(bars.map(bar => bar.timestamp)).toEqual([from]);
  });

  it("builds session-aligned hourly candles from Schwab 30-minute candles", async () => {
    const start = Date.parse("2026-11-06T14:30:00Z");
    const next = start + 30 * 60 * 1000;
    const getPriceHistory = vi.fn().mockResolvedValue({ candles: [
      { datetime: next, open: 13, high: 17, low: 12, close: 16, volume: 20 },
      { datetime: start, open: 10, high: 14, low: 9, close: 13, volume: 10 },
      { datetime: start + 60 * 60 * 1000, open: 16, high: 18, low: 15, close: 17, volume: 5 },
    ] });
    const provider = new CharlesSchwabProvider({ accessToken: "test-token" }, () => ({
      marketData: { priceHistory: { getPriceHistory } },
    }));

    const bars = await provider.fetchHistory({ symbol: "SPY", interval: "1h" });

    expect(getPriceHistory).toHaveBeenCalledWith({ queryParams: expect.objectContaining({
      frequencyType: "minute", frequency: 30, needExtendedHoursData: false,
    }) });
    expect(bars).toEqual([
      { timestamp: new Date(start), open: 10, high: 17, low: 9, close: 16, volume: 30 },
      { timestamp: new Date(start + 60 * 60 * 1000), open: 16, high: 18, low: 15, close: 17, volume: 5 },
    ]);
  });

  it("requests the day after an inclusive end date so a one-day window is not empty", async () => {
    const getPriceHistory = vi.fn().mockResolvedValue({
      candles: [
        { datetime: Date.parse("2026-11-06T00:00:00.000Z"), open: 20, high: 21, low: 19, close: 20.5, volume: 1 },
        { datetime: Date.parse("2026-11-07T00:00:00.000Z"), open: 21, high: 22, low: 20, close: 21.5, volume: 1 },
      ],
    });
    const provider = new CharlesSchwabProvider({ accessToken: "test-token" }, () => ({
      marketData: { priceHistory: { getPriceHistory } },
    }));
    const day = new Date("2026-11-06T00:00:00.000Z");

    const result = await provider.fetchHistory({ symbol: "$SPX", interval: "1d", from: day, to: day });

    expect(getPriceHistory).toHaveBeenCalledWith({
      queryParams: expect.objectContaining({
        startDate: Date.parse("2026-11-06T00:00:00.000Z"),
        endDate: Date.parse("2026-11-07T00:00:00.000Z"),
      }),
    });
    expect(result.map((bar) => bar.close)).toEqual([20.5]);
  });
});

describe("PropositionMapping", () => {
  it.each([
    ["schawb", "charles_schwab", "https://api.schwabapi.com"],
    ["schwab", "charles_schwab", "https://api.schwabapi.com"],
    ["charles_schwab", "charles_schwab", "https://api.schwabapi.com"],
    ["stooq", "stooq", "https://stooq.com"],
  ])("maps %s to the %s endpoint", (value, expectedProviderName, expectedApiUrl) => {
    const proposition = new PropositionMapping().resolveFromEnv(value);
    expect(proposition.providerName).toBe(expectedProviderName);
    expect(proposition.apiUrl).toBe(expectedApiUrl);
  });

  it("rejects unsupported propositions", () => {
    expect(() => new PropositionMapping().resolveFromEnv("etrade")).toThrow("Unsupported DATA_PROVIDER proposition");
  });
});

describe("ProviderRegistry", () => {
  const originalEnv = {
    DATA_PROVIDER: process.env.DATA_PROVIDER,
    SCHWAB_MARKET_ACCESS_TOKEN: process.env.SCHWAB_MARKET_ACCESS_TOKEN,
    SCHWAB_MARKET_REFRESH_TOKEN: process.env.SCHWAB_MARKET_REFRESH_TOKEN,
    SCHWAB_MARKET_CLIENT_ID: process.env.SCHWAB_MARKET_CLIENT_ID,
    SCHWAB_MARKET_CLIENT_SECRET: process.env.SCHWAB_MARKET_CLIENT_SECRET,
    SCHWAB_MARKET_ACCESS_TOKEN_EXPIRES_AT: process.env.SCHWAB_MARKET_ACCESS_TOKEN_EXPIRES_AT,
  };

  const restoreEnv = () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  afterEach(() => {
    restoreEnv();
  });

  it("requires an access token for Schwab provider", () => {
    process.env.DATA_PROVIDER = "schawb";
    delete process.env.SCHWAB_MARKET_ACCESS_TOKEN;
    delete process.env.SCHWAB_MARKET_REFRESH_TOKEN;

    expect(() => new ProviderRegistry()).toThrow("SCHWAB_MARKET_ACCESS_TOKEN is required when DATA_PROVIDER is Schwab");
  });

  it("rejects Schwab token placeholders from .env.example", () => {
    process.env.DATA_PROVIDER = "schawb";
    process.env.SCHWAB_MARKET_ACCESS_TOKEN = "YOUR_SCHWAB_ACCESS_TOKEN";
    process.env.SCHWAB_MARKET_REFRESH_TOKEN = "YOUR_SCHWAB_REFRESH_TOKEN";
    process.env.SCHWAB_MARKET_CLIENT_ID = "client-id";
    process.env.SCHWAB_MARKET_CLIENT_SECRET = "client-secret";

    expect(() => new ProviderRegistry()).toThrow(".env.example placeholder");
  });

  it("rejects placeholder Schwab client credentials used for token refresh", () => {
    process.env.DATA_PROVIDER = "schawb";
    process.env.SCHWAB_MARKET_ACCESS_TOKEN = "token";
    process.env.SCHWAB_MARKET_REFRESH_TOKEN = "refresh-token";
    delete process.env.SCHWAB_MARKET_CLIENT_ID;
    delete process.env.SCHWAB_MARKET_CLIENT_SECRET;
    process.env.SCHWAB_MARKET_CLIENT_ID = "YOUR_DEVELOPER_CLIENT_ID";
    process.env.SCHWAB_MARKET_CLIENT_SECRET = "YOUR_DEVELOPER_CLIENT_SECRETS";

    expect(() => new ProviderRegistry()).toThrow(/\.env\.example placeholder for SCHWAB_MARKET_CLIENT_ID, SCHWAB_MARKET_CLIENT_SECRET/);
  });

  it("derives access-token expiry from the token response instead of the environment", () => {
    process.env.DATA_PROVIDER = "schawb";
    process.env.SCHWAB_MARKET_ACCESS_TOKEN = "token";
    delete process.env.SCHWAB_MARKET_REFRESH_TOKEN;
    process.env.SCHWAB_MARKET_ACCESS_TOKEN_EXPIRES_AT = "not-a-timestamp";

    expect(() => new ProviderRegistry()).not.toThrow();
    expect(process.env.SCHWAB_MARKET_ACCESS_TOKEN_EXPIRES_AT).toBeUndefined();
  });

  it("requires Schwab credentials when refresh token is set", () => {
    process.env.DATA_PROVIDER = "schawb";
    process.env.SCHWAB_MARKET_ACCESS_TOKEN = "token";
    process.env.SCHWAB_MARKET_REFRESH_TOKEN = "refresh-token";
    delete process.env.SCHWAB_MARKET_CLIENT_ID;
    delete process.env.SCHWAB_MARKET_CLIENT_SECRET;
    delete process.env.SCHWAB_MARKET_CLIENT_ID;
    delete process.env.SCHWAB_MARKET_CLIENT_SECRET;

    expect(() => new ProviderRegistry()).toThrow("SCHWAB_MARKET_REFRESH_TOKEN requires SCHWAB_MARKET_CLIENT_ID and SCHWAB_MARKET_CLIENT_SECRET");
  });
});

it("refreshes market credentials again after expiry and shares concurrent refreshes", async () => {
  let clock = Date.parse("2026-11-17T15:00:00Z"), refreshes = 0;
  const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
  const update = vi.fn();
  const fetchMock = vi.fn<typeof fetch>(async input => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/oauth/token')) {
      refreshes++;
      return Response.json({ access_token: `access-${refreshes}`, refresh_token: `refresh-${refreshes}`, expires_in: 1800, token_type: "Bearer" });
    }
    return Response.json({ symbol: "SPY", empty: false, candles: [{ datetime: clock, open: 100, high: 102, low: 99, close: 101, volume: 100 }] });
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    const provider = new CharlesSchwabProvider({ accessToken: "expired", refreshToken: "seed", clientId: "client", clientSecret: "secret", onTokenUpdate: update });
    await provider.fetchHistory({ symbol: "SPY", interval: "1d" });
    const initial = refreshes;
    expect(initial).toBeGreaterThan(0);
    clock += 31 * 60_000;
    await Promise.all([provider.fetchHistory({ symbol: "SPY", interval: "1d" }), provider.fetchHistory({ symbol: "SPY", interval: "1d" })]);
    expect(refreshes).toBe(initial + 1);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ accessToken: `access-${refreshes}`, refreshToken: `refresh-${refreshes}` }));
  } finally { now.mockRestore(); vi.unstubAllGlobals(); }
});
