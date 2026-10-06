import { describe, expect, it, vi } from "vitest";
import { CharlesSchwabProvider } from "../src/providers/charles-schwab.js";
import { PropositionMapping } from "../src/providers/proposition-mapping.js";
import { RestRequestFactory } from "../src/rest/request-factory.js";

describe("RestRequestFactory", () => {
  it("builds GET requests from relative paths", () => {
    const request = new RestRequestFactory("https://api.schwabapi.com").create({
      method: "GET",
      path: "/marketdata/v1/pricehistory?symbol=%24VIX",
    });

    expect(request.method).toBe("GET");
    expect(request.url).toBe("https://api.schwabapi.com/marketdata/v1/pricehistory?symbol=%24VIX");
  });

  it("builds JSON requests for POST and PUT", async () => {
    const factory = new RestRequestFactory("https://api.schwabapi.com");
    const post = factory.create({ method: "POST", path: "/oauth/token", body: { grant_type: "client_credentials" } });
    const put = factory.create({ method: "PUT", path: "/resource/1", body: { enabled: true } });

    expect(post.headers.get("content-type")).toBe("application/json");
    expect(await post.text()).toBe(JSON.stringify({ grant_type: "client_credentials" }));
    expect(put.method).toBe("PUT");
    expect(await put.text()).toBe(JSON.stringify({ enabled: true }));
  });

  it("rejects GET requests with a body", () => {
    const factory = new RestRequestFactory("https://api.schwabapi.com");
    expect(() => factory.create({ method: "GET", path: "/marketdata/v1/pricehistory", body: { symbol: "$VIX" } })).toThrow("GET requests must not include a request body");
  });
});

describe("CharlesSchwabProvider", () => {
  it("fetches and normalizes price history candles", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      candles: [
        { datetime: 1704153600000, open: 12, high: 14, low: 11, close: 13, volume: 1000 },
        { datetime: 1704240000000, open: 13, high: 15, low: 12, close: 14, volume: 1200 },
      ],
    }), { status: 200 }));

    const provider = new CharlesSchwabProvider(fetcher, new RestRequestFactory("https://api.schwabapi.com"));
    const result = await provider.fetchHistory({ symbol: "$VIX", interval: "1d" });

    expect(fetcher).toHaveBeenCalledOnce();
    const request = fetcher.mock.calls[0]?.[0] as Request;
    expect(request.url).toContain("/marketdata/v1/pricehistory?symbol=%24VIX&interval=1d");
    expect(result).toHaveLength(2);
    expect(result[0]?.close).toBe(13);
  });
});

describe("PropositionMapping", () => {
  it.each(["schawb", "schwab", "charles_schwab"])("maps %s to the Charles Schwab endpoint", (value) => {
    const proposition = new PropositionMapping().resolveFromEnv(value);
    expect(proposition.providerName).toBe("charles_schwab");
    expect(proposition.apiUrl).toBe("https://api.schwabapi.com");
  });

  it("rejects unsupported propositions", () => {
    expect(() => new PropositionMapping().resolveFromEnv("etrade")).toThrow("Unsupported DATA_PROVIDER proposition");
  });
});
