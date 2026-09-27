import { Command, InvalidArgumentError } from "commander";
import type { MarketService } from "./services.js";

type JobService = Pick<MarketService, "importHistory" | "analyze" | "backtest">;
type Options = { symbol?: string; from?: Date; to?: Date };

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new InvalidArgumentError("Expected a valid date in YYYY-MM-DD format.");
  }
  return date;
}

export function createJobCommand(mode: "collect" | "backtest", service: JobService, activeSymbols: () => Promise<string[]>, output: Pick<Console, "log" | "table" | "error"> = console): Command {
  const command = new Command(mode)
    .description(mode === "collect" ? "Import and analyze active instruments once, then exit" : "Backtest stored data for active instruments once, then exit")
    .option("--symbol <symbol>", "process one instrument instead of all active instruments", (value: string) => {
      if (!value.trim()) throw new InvalidArgumentError("Symbol must not be empty.");
      return value.trim().toUpperCase();
    });
  if (mode === "collect") {
    command.option("--from <date>", "inclusive import start date (YYYY-MM-DD, UTC)", parseDate)
      .option("--to <date>", "inclusive import end date (YYYY-MM-DD, UTC)", parseDate);
  }
  return command.action(async (options: Options) => {
    if (options.from && options.to && options.from > options.to) throw new Error("--from must be on or before --to");
    const symbols = options.symbol ? [options.symbol] : await activeSymbols();
    if (symbols.length === 0) {
      output.log("No active instruments found. Add an instrument with the CLI first.");
      return;
    }
    const failures: string[] = [];
    for (const symbol of symbols) {
      try {
        if (mode === "collect") {
          const imported = await service.importHistory(symbol, options.from, options.to);
          if (imported === 0) {
            output.log({ symbol, imported, analysis: "skipped: no bars returned by provider" });
            continue;
          }
          const result = await service.analyze(symbol);
          output.log({ symbol, imported, timestamp: result.timestamp, regime: result.regime });
        } else {
          const result = await service.backtest(symbol);
          output.log({ symbol, observations: result.observations });
          output.table(result.byRegime);
        }
      } catch (error) {
        failures.push(symbol);
        output.error(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length) throw new Error(`${mode} failed for: ${failures.join(", ")}`);
  });
}
