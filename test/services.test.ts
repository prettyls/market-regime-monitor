import type { PrismaClient } from "@prisma/client";
import { expect, it, vi } from "vitest";
import { defaultPatternConfig } from "../src/config.js";
import { CompositeRegimeStrategy } from "../src/domain/strategy.js";
import { ProviderRegistry } from "../src/providers/index.js";
import { MarketService } from "../src/services.js";

it.each([50, 1725])("analyzes and saves the latest bar with %i stored bars", async (count) => {
  const stored = Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(Date.UTC(2020, 0, 1 + i)),
    open: 20, high: 22, low: 18, close: 20, volume: null
  }));
  const db = {
    instrument: { findUnique: vi.fn().mockResolvedValue({ id: "vix", config: defaultPatternConfig }) },
    marketBar: {
      findMany: vi.fn(async ({ orderBy, take }: { orderBy: { timestamp: string }; take: number }) => {
        const sorted = [...stored].sort((a, b) => orderBy.timestamp === "desc"
          ? b.timestamp.getTime() - a.timestamp.getTime()
          : a.timestamp.getTime() - b.timestamp.getTime());
        return sorted.slice(0, take);
      })
    },
    analysis: { findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    alert: { upsert: vi.fn().mockResolvedValue({ id: "alert", message: "transition" }) }
  };
  const strategy = new CompositeRegimeStrategy();
  const analyze = vi.spyOn(strategy, "analyze");
  const service = new MarketService(db as unknown as PrismaClient, new ProviderRegistry([]), { info: vi.fn(), warn: vi.fn() }, strategy);

  const result = await service.analyze("VIX");

  const input = analyze.mock.calls[0]![0];
  expect(input.map((bar) => bar.timestamp)).toEqual(stored.slice(-1000).map((bar) => bar.timestamp));
  expect(result.timestamp).toEqual(stored.at(-1)!.timestamp);
  expect(db.analysis.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { instrumentId_timestamp: { instrumentId: "vix", timestamp: stored.at(-1)!.timestamp } },
    create: expect.objectContaining({ timestamp: stored.at(-1)!.timestamp })
  }));
});
