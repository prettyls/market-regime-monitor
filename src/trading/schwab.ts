/** Only fixed, application-owned messages may be exposed to API callers. */
export class SchwabPortfolioError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 502) {
    super(message);
    this.name = "SchwabPortfolioError";
  }
}

// Deliberately read-only: no broker mutation method is exposed in this milestone.
export async function readSchwab(path: "accounts" | "orders"): Promise<unknown> {
  const token = process.env.SCHWAB_TRADE_ACCESS_TOKEN;
  if (!token) throw new SchwabPortfolioError("SCHWAB_AUTH_UNAVAILABLE", "Schwab authorization unavailable; configure credentials and restart the server", 503);
  const query = path === "accounts" ? "?fields=positions" : (() => {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 86400000);
    return `?fromEnteredTime=${encodeURIComponent(start.toISOString())}&toEnteredTime=${encodeURIComponent(end.toISOString())}`;
  })();
  let response: Response;
  try {
    response = await fetch(`https://api.schwabapi.com/trader/v1/${path}${query}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new SchwabPortfolioError("SCHWAB_CONNECTION_FAILED", "Unable to reach Schwab; retry later");
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401) throw new SchwabPortfolioError("SCHWAB_AUTH_REJECTED", "Schwab rejected portfolio authorization; check Accounts and Trading Production access and linked-account consent. If credentials changed, restart the server");
    if (response.status === 403) throw new SchwabPortfolioError("SCHWAB_ACCESS_DENIED", "Schwab denied portfolio access; check app trading API access and account authorization");
    if (response.status === 429) throw new SchwabPortfolioError("SCHWAB_RATE_LIMITED", "Schwab rate limit reached; retry later");
    throw new SchwabPortfolioError("SCHWAB_UPSTREAM_ERROR", "Schwab portfolio request failed; retry later");
  }
  try { return await response.json(); }
  catch { throw new SchwabPortfolioError("SCHWAB_INVALID_RESPONSE", "Schwab returned an invalid portfolio response"); }
}
