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
        frequencyType: "daily",
        frequency: 1,
      }),
    });
    expect(result).toHaveLength(2);
    expect(result[0]?.close).toBe(13);
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
    SCHWAB_ACCESS_TOKEN: process.env.SCHWAB_ACCESS_TOKEN,
    SCHWAB_REFRESH_TOKEN: process.env.SCHWAB_REFRESH_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    CLIENT_SECRET: process.env.CLIENT_SECRET,
  };

  const restoreEnv = () => {
    process.env.DATA_PROVIDER = originalEnv.DATA_PROVIDER;
    process.env.SCHWAB_ACCESS_TOKEN = originalEnv.SCHWAB_ACCESS_TOKEN;
    process.env.SCHWAB_REFRESH_TOKEN = originalEnv.SCHWAB_REFRESH_TOKEN;
    process.env.CLIENT_ID = originalEnv.CLIENT_ID;
    process.env.CLIENT_SECRET = originalEnv.CLIENT_SECRET;
  };

  afterEach(() => {
    restoreEnv();
  });

  it("requires an access token for Schwab provider", () => {
    process.env.DATA_PROVIDER = "schawb";
    delete process.env.SCHWAB_ACCESS_TOKEN;
    delete process.env.SCHWAB_REFRESH_TOKEN;

    expect(() => new ProviderRegistry()).toThrow("SCHWAB_ACCESS_TOKEN is required when DATA_PROVIDER is Schwab");
  });

  it("requires Schwab credentials when refresh token is set", () => {
    process.env.DATA_PROVIDER = "schawb";
    process.env.SCHWAB_ACCESS_TOKEN = "token";
    process.env.SCHWAB_REFRESH_TOKEN = "refresh-token";
    delete process.env.CLIENT_ID;
    delete process.env.CLIENT_SECRET;

    expect(() => new ProviderRegistry()).toThrow("SCHWAB_REFRESH_TOKEN requires CLIENT_ID and CLIENT_SECRET");
  });
});
