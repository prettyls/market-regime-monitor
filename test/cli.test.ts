import { afterEach, expect, it, vi } from "vitest";

const { addInstrument, disconnect } = vi.hoisted(() => ({
  addInstrument: vi.fn().mockResolvedValue({ symbol: "SPX" }),
  disconnect: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../src/db.js", () => ({ prisma: { $disconnect: disconnect } }));
vi.mock("../src/services.js", () => ({
  MarketService: class { addInstrument = addInstrument; }
}));
vi.mock("pino", () => ({ default: vi.fn(() => ({})) }));

const originalArgv = process.argv;
const originalSchwabAccessToken = process.env.SCHWAB_ACCESS_TOKEN;
afterEach(() => {
  process.argv = originalArgv;
  process.env.SCHWAB_ACCESS_TOKEN = originalSchwabAccessToken;
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("reports service failures and disconnects without printing a stack trace", async () => {
  vi.resetModules();
  process.env.SCHWAB_ACCESS_TOKEN = "test-token";
  const errorOutput = vi.spyOn(console, "error").mockImplementation(() => {});
  addInstrument.mockRejectedValueOnce(new Error("Provider unavailable"));
  process.argv = ["node", "src/cli.ts", "instrument:add", "--symbol", "SPX", "--name", "S&P 500", "--provider-symbol", "^SPX"];
  await import("../src/cli.js");
  expect(errorOutput).toHaveBeenCalledExactlyOnceWith("error: Provider unavailable");
  expect(process.exitCode).toBe(1);
  expect(disconnect).toHaveBeenCalledOnce();
});

it.each([false, true])("parses instrument:add with a forwarded separator: %s", async (separator) => {
  vi.resetModules();
  process.env.SCHWAB_ACCESS_TOKEN = "test-token";
  vi.spyOn(console, "log").mockImplementation(() => {});
  process.argv = ["node", "src/cli.ts", ...(separator ? ["--"] : []), "instrument:add", "--symbol", "SPX", "--name", "S&P 500", "--provider-symbol", "^SPX"];

  await import("../src/cli.js");

  expect(addInstrument).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    symbol: "SPX", name: "S&P 500", providerSymbol: "^SPX", kind: "INDEX", provider: "charles_schwab"
  }));
  expect(disconnect).toHaveBeenCalledOnce();
});
