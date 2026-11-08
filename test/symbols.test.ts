import type { PrismaClient } from "@prisma/client";
import { expect, it, vi } from "vitest";
import { defaultPatternConfig } from "../src/config.js";
import type { MarketDataProvider } from "../src/providers/provider.js";
import { resolveProviderSymbol } from "../src/providers/symbols.js";
import { MarketService } from "../src/services.js";

it.each([
  ["SPX", "$SPX"],
  ["^SPX", "$SPX"],
  ["$spx", "$SPX"],
  ["/ES", "/ES"]
])("maps Schwab index symbol %s to %s", (providerSymbol, expected) => {
  expect(resolveProviderSymbol({ provider: "charles_schwab", kind: "INDEX", providerSymbol })).toBe(expected);
});

it("leaves non-index and non-Schwab symbols unchanged", () => {
  expect(resolveProviderSymbol({ provider: "charles_schwab", kind: "EQUITY", providerSymbol: "AAPL" })).toBe("AAPL");
  expect(resolveProviderSymbol({ provider: "stooq", kind: "INDEX", providerSymbol: "^spx" })).toBe("^spx");
});

it("imports a Schwab index saved without the $ prefix", async () => {
  const fetchHistory = vi.fn().mockResolvedValue([{ timestamp: new Date("2020-01-02T00:00:00.000Z"), open: 1, high: 2, low: 1, close: 2 }]);
  const provider: MarketDataProvider = { name: "charles_schwab", fetchHistory };
  const db = {
    instrument: { findUnique: vi.fn().mockResolvedValue({ id: "spx", provider: "charles_schwab", kind: "INDEX", providerSymbol: "SPX" }) },
    marketBar: { upsert: vi.fn().mockReturnValue("upsert") },
    $transaction: vi.fn().mockResolvedValue([])
  };
  const service = new MarketService(db as unknown as PrismaClient, { get: () => provider } as never, { info: vi.fn(), warn: vi.fn() });

  const imported = await service.importHistory("SPX", new Date("2020-01-01"), new Date("2026-11-08"));

  expect(imported).toBe(1);
  expect(fetchHistory).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ symbol: "$SPX" }));
});

it("stores the Schwab index symbol with the $ prefix", async () => {
  const upsert = vi.fn().mockResolvedValue({ symbol: "SPX" });
  const service = new MarketService({ instrument: { upsert } } as unknown as PrismaClient, { get: vi.fn() } as never, { info: vi.fn(), warn: vi.fn() });

  await service.addInstrument({ symbol: "SPX", name: "S&P 500 Index", kind: "INDEX", provider: "charles_schwab", providerSymbol: "SPX", config: defaultPatternConfig });

  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({ providerSymbol: "$SPX" }),
    update: expect.objectContaining({ providerSymbol: "$SPX" })
  }));
});
