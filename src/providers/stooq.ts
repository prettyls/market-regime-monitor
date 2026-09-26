import type { Bar } from "../domain/types.js";
import type { HistoryRequest, MarketDataProvider } from "./provider.js";

const yyyymmdd = (date: Date): string => date.toISOString().slice(0, 10).replaceAll("-", "");
const baseUrl = "https://stooq.com";
const verificationPattern = /const c="([^"]+)",\s*d=(\d+)/;

const hashHex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const solveVerificationNonce = async (challenge: string, difficulty: number): Promise<number> => {
  const prefix = "0".repeat(difficulty);
  let nonce = 0;
  while (true) {
    if ((await hashHex(`${challenge}${nonce}`)).startsWith(prefix)) return nonce;
    nonce += 1;
  }
};

export class StooqProvider implements MarketDataProvider {
  readonly name = "stooq";
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async fetchHistory(request: HistoryRequest): Promise<readonly Bar[]> {
    const params = new URLSearchParams({ s: request.symbol.toLowerCase(), i: "d" });
    if (request.from) params.set("d1", yyyymmdd(request.from));
    if (request.to) params.set("d2", yyyymmdd(request.to));
    const response = await this.fetchCsv(params);
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

  private async fetchCsv(params: URLSearchParams): Promise<Response> {
    const url = `${baseUrl}/q/d/l/?${params.toString()}`;
    const response = await this.fetcher(url, { headers: this.requestHeaders() });
    if (response.ok) return response;

    const challengePage = await response.text();
    if (!this.isVerificationPage(challengePage)) {
      return new Response(challengePage, { status: response.status, statusText: response.statusText, headers: response.headers });
    }

    const cookie = response.headers.get("set-cookie") ?? undefined;
    const match = challengePage.match(verificationPattern);
    if (!match) {
      return new Response(challengePage, { status: response.status, statusText: response.statusText, headers: response.headers });
    }

    const challenge = match[1];
    const difficultyText = match[2];
    if (!challenge || !difficultyText) {
      return new Response(challengePage, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    const nonce = await solveVerificationNonce(challenge, Number(difficultyText));
    const verifyResponse = await this.fetcher(`${baseUrl}/__verify`, {
      method: "POST",
      headers: {
        ...this.requestHeaders(cookie),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ c: challenge, n: String(nonce) }),
    });
    if (!verifyResponse.ok) return verifyResponse;

    const verifiedCookie = [cookie, verifyResponse.headers.get("set-cookie")].filter(Boolean).join("; ");
    return this.fetcher(url, { headers: this.requestHeaders(verifiedCookie || undefined) });
  }

  private isVerificationPage(body: string): boolean {
    return body.includes("This site requires JavaScript to verify your browser") && body.includes("/__verify");
  }

  private requestHeaders(cookie?: string): HeadersInit {
    return {
      "accept": "text/csv,text/plain;q=0.9,*/*;q=0.8",
      "user-agent": "market-regime-monitor/0.1 (historical market analysis)",
      ...(cookie ? { cookie } : {}),
    };
  }
}
