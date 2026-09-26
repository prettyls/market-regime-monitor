import type { Bar } from "../domain/types.js";
import type { HistoryRequest, MarketDataProvider } from "./provider.js";

const csvUrl = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv";

const parseUsDate = (value: string): Date | undefined => {
  const [month, day, year] = value.split("/").map(Number);
  if (!month || !day || !year) return undefined;
  return new Date(Date.UTC(year, month - 1, day));
};

export class CboeVixProvider implements MarketDataProvider {
  readonly name = "cboe";

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async fetchHistory(request: HistoryRequest): Promise<readonly Bar[]> {
    const response = await this.fetcher(csvUrl, {
      headers: {
        accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "market-regime-monitor/0.1 (historical market analysis)",
      },
    });
    if (!response.ok) throw new Error(`CBOE returned HTTP ${response.status}`);

    const text = await response.text();
    const bars: Bar[] = [];
    for (const line of text.trim().split(/\r?\n/).slice(1)) {
      const [dateText, openText, highText, lowText, closeText] = line.split(",");
      if (!dateText || !openText || !highText || !lowText || !closeText) continue;
      const timestamp = parseUsDate(dateText);
      if (!timestamp) continue;
      if (request.from && timestamp < request.from) continue;
      if (request.to && timestamp > request.to) continue;

      const values = [openText, highText, lowText, closeText].map(Number);
      if (values.some((value) => !Number.isFinite(value))) continue;
      bars.push({ timestamp, open: values[0]!, high: values[1]!, low: values[2]!, close: values[3]! });
    }

    return bars.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
}