import { afterEach, expect, it, vi } from "vitest";
const tx = { $executeRaw: vi.fn(), schwabTradeToken: { findUnique: vi.fn(), upsert: vi.fn() } };
vi.mock("../src/db.js", () => ({ prisma: { $transaction: (work: (value: typeof tx) => unknown) => work(tx) } }));
import { tradeAccessToken } from "../src/trading/token.js";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
function setup() {
  vi.stubEnv("SCHWAB_TRADE_TOKEN_STORE", "database");
  vi.stubEnv("SCHWAB_TRADE_REFRESH_TOKEN", "trade-refresh");
  vi.stubEnv("SCHWAB_TRADE_CLIENT_ID", "trade-client");
  vi.stubEnv("SCHWAB_TRADE_CLIENT_SECRET", "trade-secret");
}
it("persists rotated trade credentials and reuses them across calls", async () => {
  setup();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ access_token: "fresh", refresh_token: "rotated", expires_in: 1800 }));
  vi.stubGlobal("fetch", fetch);
  expect(await tradeAccessToken()).toBe("fresh");
  const saved = tx.schwabTradeToken.upsert.mock.calls[0]![0].create;
  expect(saved.refreshToken).toBe("rotated");
  expect(String(fetch.mock.calls[0])).not.toContain("market");
  tx.schwabTradeToken.findUnique.mockResolvedValue(saved);
  expect(await tradeAccessToken()).toBe("fresh");
  expect(fetch).toHaveBeenCalledOnce();
  await tradeAccessToken(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(String(fetch.mock.calls[1]?.[1]?.body)).toContain("refresh_token=rotated");
});
it("sanitizes upstream rejection and does not overwrite stored tokens", async () => {
  setup(); vi.stubGlobal("fetch", vi.fn(async () => new Response("private", { status: 400 })));
  await expect(tradeAccessToken()).rejects.toThrow("HTTP 400");
  expect(tx.schwabTradeToken.upsert).not.toHaveBeenCalled();
});
it("replaces stored state when OAuth authorization changes", async () => {
  setup(); tx.schwabTradeToken.findUnique.mockResolvedValue({ seedHash: "old", refreshToken: "old" });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ access_token: "new", expires_in: 1800 }));
  vi.stubGlobal("fetch", fetch);
  await tradeAccessToken();
  expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain("refresh_token=trade-refresh");
});
