import { z } from "zod";
import type { PaperConfig } from "./config.js";
const quoteSchema = z.object({ assetMainType: z.literal("EQUITY"), quote: z.object({
  bidPrice: z.number().positive(), askPrice: z.number().positive(), quoteTime: z.number().positive(),
}), realtime: z.literal(true) });
export interface Quote { bid: number; ask: number; timestamp: number }
export interface SessionHours { start: string; end: string }
let refreshing: Promise<void> | undefined;
async function refreshMarketToken() {
  if (!refreshing) refreshing = (async () => {
    const client = process.env.SCHWAB_MARKET_CLIENT_ID;
    const secret = process.env.SCHWAB_MARKET_CLIENT_SECRET;
    const refresh = process.env.SCHWAB_MARKET_REFRESH_TOKEN;
    if (!client || !secret || !refresh) throw new Error("Market token expired; configure market refresh credentials");
    const response = await fetch("https://api.schwabapi.com/v1/oauth/token", {
      method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${client}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Market token refresh rejected; renew market authorization"); }
    const data = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional() }).parse(await response.json());
    process.env.SCHWAB_MARKET_ACCESS_TOKEN = data.access_token;
    if (data.refresh_token) process.env.SCHWAB_MARKET_REFRESH_TOKEN = data.refresh_token;
  })().finally(() => { refreshing = undefined; });
  await refreshing;
}
async function market(path: string): Promise<unknown> {
  if (!process.env.SCHWAB_MARKET_ACCESS_TOKEN) throw new Error("SCHWAB_MARKET_ACCESS_TOKEN required for paper market checks");
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`https://api.schwabapi.com/marketdata/v1/${path}`, {
      headers: { Authorization: `Bearer ${process.env.SCHWAB_MARKET_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(15000),
    });
    if (response.ok) return response.json();
    await response.body?.cancel();
    if (response.status === 401 && attempt === 0) { await refreshMarketToken(); continue; }
    throw new Error(`Paper market-data request failed (HTTP ${response.status})`);
  }
  throw new Error("Paper market-data authorization unavailable");
}
export async function sessionHours(date: string): Promise<SessionHours | null> {
  const data = z.object({ equity: z.record(z.string(), z.object({
    isOpen: z.boolean(), sessionHours: z.object({ regularMarket: z.array(z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }) })) }).optional(),
  })) }).parse(await market(`markets/equity?date=${encodeURIComponent(date)}`));
  const hours = data.equity.EQ;
  if (!hours) throw new Error("Equity session calendar unavailable");
  if (!hours.isOpen) return null;
  const regular = hours.sessionHours?.regularMarket;
  if (!regular || regular.length !== 1) throw new Error("Regular equity session unavailable");
  return regular[0]!;
}
export function validateQuote(raw: unknown, config: PaperConfig, now = Date.now()): Quote {
  const data = quoteSchema.parse(raw);
  const { bidPrice: bid, askPrice: ask, quoteTime: timestamp } = data.quote;
  if (ask < bid || timestamp > now + 5000 || now - timestamp > config.maxQuoteAgeSeconds * 1000) throw new Error("Stale or invalid live quote");
  if ((ask - bid) / ((ask + bid) / 2) * 10000 > config.maxSpreadBps) throw new Error("Quote spread exceeds paper policy");
  return { bid, ask, timestamp };
}
export async function liveQuotes(symbols: string[], config: PaperConfig): Promise<Record<string, Quote>> {
  const data = z.record(z.string(), z.unknown()).parse(await market(`quotes?symbols=${encodeURIComponent(symbols.join(","))}&fields=quote&indicative=false`));
  return Object.fromEntries(symbols.map(symbol => [symbol, validateQuote(data[symbol], config)]));
}
