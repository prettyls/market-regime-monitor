import { tradeAccessToken } from "./token.js";
/** Only fixed, application-owned messages may be exposed to API callers. */
export class SchwabPortfolioError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 502, readonly upstreamStatus?: number) {
    super(message);
    this.name = "SchwabPortfolioError";
  }
}

export async function readSchwab(path: "accounts" | "orders"): Promise<unknown> {
  const query = path === "accounts" ? "?fields=positions" : (() => {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 86400000);
    return `?fromEnteredTime=${encodeURIComponent(start.toISOString())}&toEnteredTime=${encodeURIComponent(end.toISOString())}`;
  })();
  return readSchwabResource(`${path}${query}`);
}

// Resource paths are constructed only by server-owned read-only adapters.
export async function readSchwabResource(resource: string): Promise<unknown> {
  let token: string | undefined;
  try { token = await tradeAccessToken(); }
  catch { throw new SchwabPortfolioError("SCHWAB_AUTH_UNAVAILABLE", "Schwab trading authorization refresh unavailable; check token refresh job", 503); }
  if (!token) throw new SchwabPortfolioError("SCHWAB_AUTH_UNAVAILABLE", "Schwab authorization unavailable; configure credentials and restart the server", 503);
  let response: Response;
  try {
    response = await fetch(`https://api.schwabapi.com/trader/v1/${resource}`, {
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
    throw new SchwabPortfolioError("SCHWAB_UPSTREAM_ERROR", "Schwab upstream request failed", 502, response.status);
  }
  try { return await response.json(); }
  catch { throw new SchwabPortfolioError("SCHWAB_INVALID_RESPONSE", "Schwab returned an invalid portfolio response"); }
}

/** A failed or ambiguous transport must never cause this POST to be retried. */
export async function submitSchwabOrder(
  token: string,
  accountHash: string,
  order: import("./policy.js").LiveOrderInput,
) {
  const response = await fetch(`https://api.schwabapi.com/trader/v1/accounts/${encodeURIComponent(accountHash)}/orders`, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      orderType: order.orderType,
      session: "NORMAL",
      duration: order.timeInForce,
      price: Number(order.limitPrice),
      orderStrategyType: "SINGLE",
      orderLegCollection: [{
        instruction: order.side,
        quantity: order.quantity,
        instrument: { symbol: order.symbol, assetType: "EQUITY" },
      }],
    }),
  });
  const brokerOrderId = response.headers.get("location")?.match(/\/orders\/(\d+)\/?$/)?.[1];
  await response.body?.cancel().catch(() => {});
  if (response.status === 201 && brokerOrderId) return { status: "SUBMITTED", brokerOrderId };
  if ([400, 401, 403, 404, 422, 429].includes(response.status)) return { status: "REJECTED" };
  return { status: "UNKNOWN" };
}
