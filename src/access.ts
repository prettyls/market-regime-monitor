import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

const digest = (value: string) => createHash("sha256").update(value).digest();
const publicRoutes = new Set(["/", "/analysis", "/health", "/api/v1/instruments", "/api/v1/analyses/latest", "/api/v1/instruments/:symbol/analysis", "/api/v1/alerts"]);

export function registerAccess(app: FastifyInstance) {
  const username = process.env.ADMIN_USERNAME ?? "admin";
  const password = process.env.ADMIN_PASSWORD;
  if (password && password.length < 32) throw new Error("ADMIN_PASSWORD must contain at least 32 characters");
  // Bounded per-instance cache. Only successful public JSON reads are cached.
  const cache = new Map<string, { until: number; payload: string; type: string }>();
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff").header("X-Frame-Options", "DENY").header("Referrer-Policy", "same-origin");
    const route = request.routeOptions.url ?? "";
    const isPublic = ["GET", "HEAD"].includes(request.method) && publicRoutes.has(route);
    if (isPublic) {
      const entry = cache.get(request.url);
      if (entry && entry.until > Date.now()) return reply.type(entry.type).send(entry.payload);
      return;
    }
    reply.header("Cache-Control", "no-store");
    // These routes enforce their own scoped bearer credentials.
    if (route.startsWith("/api/v1/agent/") || route.startsWith("/api/v1/trade-proposals")) return;
    const authorization = request.headers.authorization ?? "";
    const supplied = authorization.startsWith("Basic ") ? Buffer.from(authorization.slice(6), "base64").toString("utf8") : "";
    if (!password || !timingSafeEqual(digest(supplied), digest(`${username}:${password}`))) {
      return reply.header("WWW-Authenticate", 'Basic realm="Market Monitor Admin", charset="UTF-8"').code(401).send({ message: "Administrator authentication required" });
    }
    // Browsers cache Basic credentials; reject cross-origin writes as well.
    if (!["GET", "HEAD"].includes(request.method) &&
        (request.headers["sec-fetch-site"] === "cross-site" ||
         (request.headers.origin && request.headers.origin !== `https://${request.headers.host}` && request.headers.origin !== `http://${request.headers.host}`))) {
      return reply.code(403).send({ message: "Cross-origin writes are forbidden" });
    }
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method === "GET" && publicRoutes.has(request.routeOptions.url ?? "") && request.url.startsWith("/api/") && reply.statusCode === 200 && typeof payload === "string" && Buffer.byteLength(payload) <= 256 * 1024) {
      if ((cache.get(request.url)?.until ?? 0) > Date.now()) return payload;
      if (cache.size >= 128) cache.delete(cache.keys().next().value!);
      cache.set(request.url, { until: Date.now() + 15_000, payload, type: String(reply.getHeader("content-type") ?? "application/json") });
    }
    if (!["GET", "HEAD"].includes(request.method) && reply.statusCode < 400) cache.clear();
    return payload;
  });
}
