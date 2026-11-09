import { afterEach, expect, it, vi } from "vitest";
import { createJobCommand } from "../src/job-command.js";

afterEach(() => vi.useRealTimers());

function setup(mode: "collect" | "backtest" = "collect") {
  const service = {
    importHistory: vi.fn().mockResolvedValue(10),
    analyze: vi.fn().mockResolvedValue({ timestamp: new Date("2026-09-25"), regime: "RANGE" }),
    backtest: vi.fn().mockResolvedValue({ observations: 5, byRegime: [{ regime: "RANGE", observations: 5, averageNextReturn: 0.01 }] })
  };
  const activeSymbols = vi.fn().mockResolvedValue(["VIX", "SPX"]);
  const output = { log: vi.fn(), table: vi.fn(), error: vi.fn() };
  const command = createJobCommand(mode, service, activeSymbols, output).exitOverride().configureOutput({ writeErr: () => {} });
  return { service, activeSymbols, output, run: (...args: string[]) => command.parseAsync(args, { from: "user" }) };
}

it("collects and then analyzes every active instrument", async () => {
  const { service, activeSymbols, run } = setup();
  await run();
  expect(activeSymbols).toHaveBeenCalledOnce();
  expect(service.importHistory.mock.calls.map(([symbol]) => symbol)).toEqual(["VIX", "SPX"]);
  expect(service.analyze.mock.calls.map(([symbol]) => symbol)).toEqual(["VIX", "SPX"]);
  expect(service.importHistory.mock.invocationCallOrder[0]).toBeLessThan(service.analyze.mock.invocationCallOrder[0]!);
  expect(service.backtest).not.toHaveBeenCalled();
});

it("imports the previous weekday bar for every active instrument", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-02T12:30:00.000Z"));
  const { service, activeSymbols, run } = setup();
  await run("--last-day");
  const friday = new Date("2026-02-27T00:00:00.000Z");
  expect(activeSymbols).toHaveBeenCalledOnce();
  expect(service.importHistory).toHaveBeenNthCalledWith(1, "VIX", friday, friday);
  expect(service.importHistory).toHaveBeenNthCalledWith(2, "SPX", friday, friday);
  expect(service.analyze.mock.calls.map(([symbol]) => symbol)).toEqual(["VIX", "SPX"]);
});

it("collects only the requested symbol and passes date boundaries", async () => {
  const { service, activeSymbols, run } = setup();
  await run("--symbol", "vix", "--from", "2024-02-29", "--to", "2024-03-01");
  expect(activeSymbols).not.toHaveBeenCalled();
  expect(service.importHistory).toHaveBeenCalledExactlyOnceWith("VIX", new Date("2024-02-29"), new Date("2024-03-01"));
});

it("continues after provider failures and reports an overall failure", async () => {
  const { service, output, run } = setup();
  service.importHistory.mockRejectedValueOnce(new Error("HTTP 403"));
  await expect(run()).rejects.toThrow("collect failed for: VIX");
  expect(output.error).toHaveBeenCalledWith("VIX: HTTP 403");
  expect(service.analyze).toHaveBeenCalledExactlyOnceWith("SPX");
});

it("skips analysis on empty imports", async () => {
  const { service, run } = setup();
  service.importHistory.mockResolvedValue(0);
  await run();
  expect(service.analyze).not.toHaveBeenCalled();
});

it.each(["collect", "backtest"] as const)("handles no active instruments in %s", async (mode) => {
  const { service, activeSymbols, output, run } = setup(mode);
  activeSymbols.mockResolvedValue([]);
  await run();
  expect(output.log).toHaveBeenCalledWith(expect.stringContaining("No active instruments"));
  expect(service.importHistory).not.toHaveBeenCalled();
  expect(service.backtest).not.toHaveBeenCalled();
});

it.each([[], ["--symbol", "vix"]])("backtests stored data without collection: %j", async (...args) => {
  const { service, output, run } = setup("backtest");
  await run(...args);
  expect(service.backtest).toHaveBeenCalledWith("VIX");
  expect(service.backtest).toHaveBeenCalledTimes(args.length ? 1 : 2);
  expect(output.table).toHaveBeenCalled();
  expect(service.importHistory).not.toHaveBeenCalled();
  expect(service.analyze).not.toHaveBeenCalled();
});

it.each([
  ["--from", "2023-02-29"],
  ["--from", "2024-03-01", "--to", "2024-02-29"],
  ["--symbol", " "],
  ["--last-day", "--from", "2024-01-01"],
  ["--last-day", "--to", "2024-01-02"]
])("rejects invalid options before any work: %j", async (...args) => {
  const { service, activeSymbols, run } = setup();
  await expect(run(...args)).rejects.toThrow();
  expect(activeSymbols).not.toHaveBeenCalled();
  expect(service.importHistory).not.toHaveBeenCalled();
});
