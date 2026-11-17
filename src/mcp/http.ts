import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { agentSchema } from "../trading/routes.js";
import { createTradingMcpServer } from "./server.js";

export function registerMcpHttp(app: FastifyInstance) {
  const agents = agentSchema.parse(JSON.parse(process.env.AGENT_CREDENTIALS_JSON ?? "[]"));
  const digest = (value: string) => createHash("sha256").update(value).digest();
  app.route({ method: ["GET", "POST", "DELETE"], url: "/mcp", handler: async (request, reply) => {
    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? "";
    const agent = agents.find(a => timingSafeEqual(digest(a.token), digest(token)));
    if (!agent) return reply.code(401).send({ error: "Agent authentication required" });
    if (agent.role !== "admin") return reply.code(403).send({ error: "Administrator role required" });
    // Non-browser clients omit Origin. Browser callers must have the same origin.
    if (request.headers.origin && request.headers.origin !== `https://${request.headers.host}` && request.headers.origin !== `http://${request.headers.host}`) return reply.code(403).send({ error: "Invalid origin" });
    if (request.method !== "POST") return reply.header("Allow", "POST").code(405).send();
    // Use internal injection: no external base URL or Host header can redirect credentials.
    const apiFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const result = await app.inject({ method: init?.method === "POST" ? "POST" : "GET", url: url.pathname, headers: { authorization: `Bearer ${token}`, ...(init?.body ? { "content-type": "application/json" } : {}) }, ...(init?.body ? { payload: String(init.body) } : {}) });
      return new Response(result.body, { status: result.statusCode, headers: { "content-type": "application/json" } });
    };
    const server = createTradingMcpServer({ apiUrl: "http://localhost", agentToken: token }, apiFetch);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    try {
      await server.connect(transport);
      const headers = new Headers();
      for (const name of ["accept", "content-type", "mcp-protocol-version"]) {
        const value = request.headers[name]; if (typeof value === "string") headers.set(name, value);
      }
      const response = await transport.handleRequest(new Request("http://localhost/mcp", { method: "POST", headers }), { parsedBody: request.body });
      const body = await response.text();
      response.headers.forEach((value, name) => reply.header(name, value));
      return reply.code(response.status).send(body);
    } finally { await server.close(); }
  } });
}
