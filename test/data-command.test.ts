import { describe, expect, it, vi } from "vitest";
import { createDataCommand } from "../src/data-command.js";

function setup() {
  const service = { getHistory: vi.fn().mockResolvedValue([]) };
  const output = { log: vi.fn(), table: vi.fn() };
  const command = createDataCommand(service, output).exitOverride().configureOutput({ writeErr: () => {} });
  const run = (...args: string[]) => command.parseAsync(args, { from: "user" });
  return { service, output, run };
}

describe("data command", () => {
  it("shows all stored bars with normalized symbols and readable dates", async () => {
    const { service, output, run } = setup();
    service.getHistory.mockResolvedValue([{ timestamp: new Date("2024-01-02"), open: 12, high: 14, low: 11, close: 13, volume: null }]);
    await run("--symbol", "vix");
    expect(service.getHistory).toHaveBeenCalledWith("VIX", undefined, undefined);
    expect(output.table).toHaveBeenCalledWith([{ date: "2024-01-02", open: 12, high: 14, low: 11, close: 13, volume: null }]);
  });

  it.each([
    [["--from", "2024-02-29"], new Date("2024-02-29T00:00:00Z"), undefined],
    [["--to", "2024-02-29"], undefined, new Date("2024-02-29T23:59:59.999Z")],
    [["--from", "2024-02-29", "--to", "2024-02-29"], new Date("2024-02-29T00:00:00Z"), new Date("2024-02-29T23:59:59.999Z")]
  ])("supports inclusive and open-ended ranges: %j", async (args, from, to) => {
    const { service, run } = setup();
    await run("--symbol", "VIX", ...args);
    expect(service.getHistory).toHaveBeenCalledWith("VIX", from, to);
  });

  it.each([
    [], ["--symbol", " "], ["--symbol", "VIX", "--from", "2023-02-29"],
    ["--symbol", "VIX", "--to", "not-a-date"],
    ["--symbol", "VIX", "--from", "2024-03-02", "--to", "2024-03-01"]
  ])("rejects invalid input before querying: %j", async (...args) => {
    const { service, run } = setup();
    await expect(run(...args)).rejects.toThrow();
    expect(service.getHistory).not.toHaveBeenCalled();
  });

  it("explains empty results", async () => {
    const { output, run } = setup();
    await run("--symbol", "VIX");
    expect(output.log).toHaveBeenCalledWith("No imported data found for VIX in the requested date range.");
    expect(output.table).not.toHaveBeenCalled();
  });

  it("reports lookup failures as command errors", async () => {
    const { service, run } = setup();
    service.getHistory.mockRejectedValue(new Error("Instrument UNKNOWN not found"));
    await expect(run("--symbol", "UNKNOWN")).rejects.toThrow("Instrument UNKNOWN not found");
  });
});
