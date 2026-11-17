import { createHash } from "node:crypto";
import { prisma } from "../db.js";

// Shared storage and lock keep scheduled refreshes and all Cloud Run replicas in sync.
// A newly authorized refresh token in the environment replaces the stored seed.
export async function tradeAccessToken(force = false): Promise<string | undefined> {
  if (process.env.SCHWAB_TRADE_TOKEN_STORE !== "database") return process.env.SCHWAB_TRADE_ACCESS_TOKEN;
  const refresh = process.env.SCHWAB_TRADE_REFRESH_TOKEN;
  const clientId = process.env.SCHWAB_TRADE_CLIENT_ID;
  const secret = process.env.SCHWAB_TRADE_CLIENT_SECRET;
  if (!refresh || !clientId || !secret) throw new Error("Schwab trade refresh credentials unavailable");
  const seedHash = createHash("sha256").update(`${clientId}:${refresh}`).digest("hex");
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(79013202)`;
    const saved = await tx.schwabTradeToken.findUnique({ where: { id: "trade" } });
    const current = saved?.seedHash === seedHash ? saved : undefined;
    if (!force && current && current.expiresAt.getTime() > Date.now() + 120_000) return current.accessToken;
    const response = await fetch("https://api.schwabapi.com/v1/oauth/token", {
      method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: current?.refreshToken ?? refresh }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Schwab trade token refresh failed (HTTP ${response.status}); renew trading authorization if expired`);
    }
    const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!data.access_token || typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error("Invalid Schwab token response");
    const token = { seedHash, accessToken: data.access_token, refreshToken: data.refresh_token || current?.refreshToken || refresh, expiresAt: new Date(Date.now() + data.expires_in * 1000) };
    await tx.schwabTradeToken.upsert({ where: { id: "trade" }, create: { id: "trade", ...token }, update: token });
    return token.accessToken;
  }, { timeout: 25000, maxWait: 30000 });
}
