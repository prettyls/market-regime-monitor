import { afterEach, expect, it, vi } from "vitest";
import { readSchwab } from "../src/trading/schwab.js";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it.each([
  [401, "SCHWAB_AUTH_REJECTED"], [403, "SCHWAB_ACCESS_DENIED"],
  [429, "SCHWAB_RATE_LIMITED"], [500, "SCHWAB_UPSTREAM_ERROR"],
])("maps Schwab %s to a safe error", async (status, code) => {
  vi.stubEnv("SCHWAB_TRADE_ACCESS_TOKEN", "private-token");
  const fetch = vi.fn(async () => new Response("private upstream details", { status }));
  vi.stubGlobal("fetch", fetch);
  await expect(readSchwab("accounts")).rejects.toMatchObject({ code, statusCode: 502 });
  await expect(readSchwab("accounts")).rejects.not.toThrow("private");
  if (status === 500) await expect(readSchwab("accounts")).rejects.toMatchObject({ upstreamStatus: 500 });
});
it("rejects missing credentials without a network call", async () => {
  vi.stubEnv("SCHWAB_TRADE_ACCESS_TOKEN", "");
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(readSchwab("accounts")).rejects.toMatchObject({ code: "SCHWAB_AUTH_UNAVAILABLE", statusCode: 503 });
  expect(fetch).not.toHaveBeenCalled();
});
it("sanitizes connection failures", async () => {
  vi.stubEnv("SCHWAB_TRADE_ACCESS_TOKEN", "private-token");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private connection details")));
  await expect(readSchwab("accounts")).rejects.toMatchObject({ code: "SCHWAB_CONNECTION_FAILED" });
});
it("returns successful portfolio data", async () => {
  vi.stubEnv("SCHWAB_TRADE_ACCESS_TOKEN", "private-token");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ securitiesAccount: { positions: [] } }])));
  await expect(readSchwab("accounts")).resolves.toEqual([{ securitiesAccount: { positions: [] } }]);
});
it("uses only trading credentials even when market credentials are present", async () => {
  vi.stubEnv("SCHWAB_MARKET_ACCESS_TOKEN", "market-only");
  vi.stubEnv("SCHWAB_TRADE_ACCESS_TOKEN", "trade-only");
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json([])); vi.stubGlobal("fetch", fetch);
  await readSchwab("accounts");
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: "Bearer trade-only" } });
});
it("never falls back to market credentials for portfolio access", async () => {
  vi.stubEnv("SCHWAB_MARKET_ACCESS_TOKEN", "market-only");
  vi.stubEnv("SCHWAB_TRADE_ACCESS_TOKEN", "");
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(readSchwab("accounts")).rejects.toMatchObject({ code: "SCHWAB_AUTH_UNAVAILABLE" });
  expect(fetch).not.toHaveBeenCalled();
});
