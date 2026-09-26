import { describe, expect, it, vi } from "vitest";
import { StooqProvider } from "../src/providers/stooq.js";
describe("StooqProvider", () => { it("parses historical CSV", async () => { const fetcher = vi.fn().mockResolvedValue(new Response("Date,Open,High,Low,Close,Volume\n2026-01-02,10,12,9,11,100\n")); const result = await new StooqProvider(fetcher).fetchHistory({ symbol: "^VIX", interval: "1d" }); expect(result).toHaveLength(1); expect(result[0]?.close).toBe(11); }); });
