import type { Bar } from "../domain/types.js";
import type { HistoryRequest, MarketDataProvider } from "./provider.js";

const yyyymmdd = (date: Date): string => date.toISOString().slice(0, 10).replaceAll("-", "");

export class StooqProvider implements MarketDataProvider {
  readonly name = "stooq";
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async fetchHistory(request: HistoryRequest): Promise<readonly Bar[]> {
    const params = new URLSearchParams({ s: request.symbol.toLowerCase(), i: "d" });
    if (request.from) params.set("d1", yyyymmdd(request.from));
    if (request.to) params.set("d2", yyyymmdd(request.to));
    const response = await this.fetcher(`https://stooq.com/q/d/l/?${params.toString()}`, { headers: { "user-agent": "market-regime-monitor/0.1 (historical market analysis)" } });
    if (!response.ok) throw new Error(`Stooq returned HTTP ${response.status}`);
    const text = await response.text();
    if (text.trim().startsWith("No data")) return [];
    const lines = text.trim().split(/\r?\n/);
    const bars: Bar[] = [];
    for (const line of lines.slice(1)) {
      const [date, open, high, low, close, volume] = line.split(",");
      if (!date || !open || !high || !low || !close) continue;
      const values = [open, high, low, close].map(Number);
      if (values.some((value) => !Number.isFinite(value))) continue;
      bars.push({ timestamp: new Date(`${date}T00:00:00.000Z`), open: values[0]!, high: values[1]!, low: values[2]!, close: values[3]!, ...(volume && Number.isFinite(Number(volume)) ? { volume: Number(volume) } : {}) });
    }
    return bars.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
}
