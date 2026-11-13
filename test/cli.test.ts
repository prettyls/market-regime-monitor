import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPatternConfig } from "../src/config.js";

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
const originalDataProvider = process.env.DATA_PROVIDER;
const originalSchwabAccessToken = process.env.SCHWAB_ACCESS_TOKEN;
const originalSchwabRefreshToken = process.env.SCHWAB_REFRESH_TOKEN;
afterEach(() => {
  process.argv = originalArgv;
  process.env.DATA_PROVIDER = originalDataProvider;
  process.env.SCHWAB_ACCESS_TOKEN = originalSchwabAccessToken;
  process.env.SCHWAB_REFRESH_TOKEN = originalSchwabRefreshToken;
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("reports service failures and disconnects without printing a stack trace", async () => {
  vi.resetModules();
  process.env.DATA_PROVIDER = "stooq";
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
  process.env.DATA_PROVIDER = "stooq";
  vi.spyOn(console, "log").mockImplementation(() => {});
  process.argv = ["node", "src/cli.ts", ...(separator ? ["--"] : []), "instrument:add", "--symbol", "SPX", "--name", "S&P 500", "--provider-symbol", "^SPX"];

  await import("../src/cli.js");

  expect(addInstrument).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    symbol: "SPX", name: "S&P 500", providerSymbol: "^SPX", kind: "INDEX", provider: "charles_schwab"
  }));
  expect(disconnect).toHaveBeenCalledOnce();
});

async function loadFile(contents: string) {
  const directory = await mkdtemp(join(tmpdir(), "instruments-cli-"));
  try {
    const file = join(directory, "instruments.json");
    await writeFile(file, contents);
    vi.resetModules();
    process.env.DATA_PROVIDER = "stooq";
    process.argv = ["node", "src/cli.ts", "instruments:load", file];
    await import("../src/cli.js");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

it("loads multiple instruments with defaults and custom configuration", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const config = { ...defaultPatternConfig, meanReversion: { lookback: 40, zScoreEntry: 3 } };
  await loadFile(JSON.stringify([
    { symbol: "vix", name: "VIX", providerSymbol: "$VIX", kind: "INDEX", provider: "charles_schwab" },
    { symbol: "spy", name: "SPY", providerSymbol: "spy.us", kind: "ETF", provider: "stooq", config }
  ]));
  expect(addInstrument).toHaveBeenNthCalledWith(1, { symbol: "VIX", name: "VIX", providerSymbol: "$VIX", kind: "INDEX", provider: "charles_schwab", config: defaultPatternConfig });
  expect(addInstrument).toHaveBeenNthCalledWith(2, { symbol: "SPY", name: "SPY", providerSymbol: "spy.us", kind: "ETF", provider: "stooq", config });
  expect(disconnect).toHaveBeenCalledOnce();
});

it.each([
  "not json",
  "{}",
  "[]",
  JSON.stringify([{ symbol: "SPY", name: "SPY", providerSymbol: "SPY", kind: "ETF", provider: "charles_schwab" }, { symbol: "BAD" }]),
  JSON.stringify([{ symbol: "spy", name: "SPY", providerSymbol: "SPY", kind: "ETF", provider: "charles_schwab" }, { symbol: "SPY", name: "Duplicate", providerSymbol: "SPY", kind: "ETF", provider: "charles_schwab" }])
])("rejects invalid files before writing: %s", async (contents) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await loadFile(contents);
  expect(addInstrument).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  expect(disconnect).toHaveBeenCalledOnce();
});


it.each(["symbol", "name", "kind", "provider", "providerSymbol"])("requires %s in every JSON instrument", async (field) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const valid = { symbol: "SPY", name: "SPY", kind: "ETF", provider: "charles_schwab", providerSymbol: "SPY" };
  const incomplete: Record<string, string> = { ...valid, symbol: "QQQ" };
  delete incomplete[field];
  await loadFile(JSON.stringify([valid, incomplete]));
  expect(addInstrument).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  expect(disconnect).toHaveBeenCalledOnce();
});
