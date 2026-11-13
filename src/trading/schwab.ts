// Deliberately read-only: no broker mutation method is exposed in this milestone.
export async function readSchwab(path: "accounts" | "orders"): Promise<unknown> {
  const token = process.env.SCHWAB_ACCESS_TOKEN;
  if (!token) throw Object.assign(new Error("Schwab authorization unavailable"), { statusCode: 503 });
  const query = path === "accounts" ? "?fields=positions" : (() => {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 86400000);
    return `?fromEnteredTime=${encodeURIComponent(start.toISOString())}&toEnteredTime=${encodeURIComponent(end.toISOString())}`;
  })();
  const response = await fetch(`https://api.schwabapi.com/trader/v1/${path}${query}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Object.assign(new Error(response.status === 401 ? "Schwab authorization expired; renew credentials" : "Schwab portfolio request failed"), { statusCode: 502 });
  return response.json();
}
