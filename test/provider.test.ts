import { describe, expect, it, vi } from "vitest";
import { CboeVixProvider } from "../src/providers/cboe.js";
import { StooqProvider } from "../src/providers/stooq.js";
describe("StooqProvider", () => {
	it("reports access denial without retrying", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("Access denied", { status: 403 }));
		await expect(new StooqProvider(fetcher).fetchHistory({ symbol: "^SPX", interval: "1d" })).rejects.toThrow("Stooq returned HTTP 403 for ^SPX");
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it("rejects HTML instead of treating it as an empty import", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>Unavailable</html>"));
		await expect(new StooqProvider(fetcher).fetchHistory({ symbol: "^SPX", interval: "1d" })).rejects.toThrow("instead of historical CSV data");
	});
	it("parses historical CSV", async () => {
		const fetcher = vi.fn().mockResolvedValue(new Response("Date,Open,High,Low,Close,Volume\n2026-01-02,10,12,9,11,100\n"));

		const result = await new StooqProvider(fetcher).fetchHistory({ symbol: "^VIX", interval: "1d" });

		expect(result).toHaveLength(1);
		expect(result[0]?.close).toBe(11);
	});

	it.each([200, 403])("handles verification with HTTP %s and replaces stale cookies", async (status) => {
		const challengePage = `<!DOCTYPE html><noscript>This site requires JavaScript to verify your browser. Please enable JavaScript and reload.</noscript><script>(async()=>{const c="challenge-token",d=1,t="0".repeat(d);const r=await fetch("/__verify",{method:"POST",body:"c="+encodeURIComponent(c)+"&n=1"});if(r.ok)location.reload()})();</script>`;
		const fetcher = vi.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(challengePage, { status, headers: { "set-cookie": "stq=challenge; Path=/; HttpOnly" } }))
			.mockResolvedValueOnce(new Response("verified", { status: 200, headers: { "set-cookie": "stq=verified; Path=/; Secure" } }))
			.mockResolvedValueOnce(new Response("Date,Open,High,Low,Close,Volume\n2026-01-02,10,12,9,11,100\n", { status: 200 }));

		const result = await new StooqProvider(fetcher).fetchHistory({ symbol: "VIX", interval: "1d" });

		expect(result).toHaveLength(1);
		expect(fetcher).toHaveBeenCalledTimes(3);
		expect(fetcher.mock.calls[1]?.[0]).toBe("https://stooq.com/__verify");
		expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
			method: "POST",
			headers: expect.objectContaining({ cookie: "stq=challenge", "content-type": "application/x-www-form-urlencoded" }),
		});
		expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
			headers: expect.objectContaining({ cookie: "stq=verified" }),
		});
	});
});

describe("CboeVixProvider", () => {
	it("parses and filters VIX history", async () => {
		const fetcher = vi.fn().mockResolvedValue(new Response("DATE,OPEN,HIGH,LOW,CLOSE\n01/02/2020,12,13,11,12.5\n01/03/2020,14,15,13,14.5\n"));

		const result = await new CboeVixProvider(fetcher).fetchHistory({ symbol: "VIX", interval: "1d", from: new Date("2020-01-03T00:00:00.000Z") });

		expect(result).toEqual([
			expect.objectContaining({
				timestamp: new Date("2020-01-03T00:00:00.000Z"),
				open: 14,
				high: 15,
				low: 13,
				close: 14.5,
			}),
		]);
	});
});
