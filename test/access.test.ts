import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { registerAccess } from "../src/access.js";
afterEach(() => vi.unstubAllEnvs());
const password = "x".repeat(32);
const headers = { authorization: `Basic ${Buffer.from(`admin:${password}`).toString("base64")}` };
function setup() {
  const app = Fastify();
  registerAccess(app);
  const work = vi.fn(async () => ({ ok: true }));
  for (const url of ["/", "/analysis", "/api/v1/instruments", "/api/v1/analyses/latest", "/api/v1/instruments/:symbol/analysis", "/api/v1/alerts", "/instruments/new", "/admin", "/api/v1/auth/token-status", "/api/v1/instruments/:symbol/backtest", "/api/v1/instruments/:symbol/pricehistory"]) app.get(url, work);
  for (const url of ["/api/v1/instruments", "/api/v1/instruments/:symbol/import", "/api/v1/instruments/:symbol/analyze"]) app.post(url, work);
  return { app, work };
}
it("allows public reads and denies administrative routes before work", async () => {
  vi.stubEnv("ADMIN_PASSWORD", password);
  const { app, work } = setup();
  for (const url of ["/", "/analysis?symbol=SPY", "/api/v1/instruments", "/api/v1/analyses/latest", "/api/v1/instruments/SPY/analysis", "/api/v1/alerts?symbol=SPY"]) expect((await app.inject(url)).statusCode).toBe(200);
  work.mockClear();
  for (const url of ["/instruments/new", "/admin", "/api/v1/auth/token-status", "/api/v1/instruments/SPY/backtest", "/api/v1/instruments/SPY/pricehistory"]) expect((await app.inject(url)).statusCode).toBe(401);
  for (const url of ["/api/v1/instruments", "/api/v1/instruments/SPY/import", "/api/v1/instruments/SPY/analyze"]) expect((await app.inject({ method: "POST", url })).statusCode).toBe(401);
  expect(work).not.toHaveBeenCalled();
  expect((await app.inject({ url: "/admin", headers })).statusCode).toBe(200);
  expect((await app.inject({ method: "POST", url: "/api/v1/instruments", headers: { ...headers, origin: "https://evil.example" } })).statusCode).toBe(403);
  await app.close();
});
it("fails closed without a password", async () => {
  vi.stubEnv("ADMIN_PASSWORD", "");
  const { app, work } = setup();
  expect((await app.inject({ url: "/instruments/new", headers })).statusCode).toBe(401);
  expect(work).not.toHaveBeenCalled();
  await app.close();
});
it("caches public reads for 15 seconds without extending expiry on hits", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  const { app, work } = setup();
  try {
    await app.inject("/api/v1/analyses/latest");
    now.mockReturnValue(15000);
    await app.inject("/api/v1/analyses/latest");
    expect(work).toHaveBeenCalledTimes(1);
    now.mockReturnValue(16001);
    await app.inject("/api/v1/analyses/latest");
    expect(work).toHaveBeenCalledTimes(2);
  } finally { now.mockRestore(); await app.close(); }
});
