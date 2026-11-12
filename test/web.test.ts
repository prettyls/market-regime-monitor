import { Script, runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { newInstrumentHtml } from "../src/web/new-instrument.js";
import { analysisHtml, uiHtml } from "../src/web/ui.js";

describe("web ui", () => {
  it("offers only the configured providers on the add instrument page", () => {
    const html = newInstrumentHtml(["stooq"]);
    expect(html).toContain('<option value="stooq">stooq</option>');
    expect(html).not.toContain("charles_schwab");
  });

  it("prefills the default pattern config and escapes provider names", () => {
    const html = newInstrumentHtml(['<x">']);
    expect(html).toContain("&#34;confirmationBars&#34;: 2");
    expect(html).not.toContain('<x">');
  });

  it("links the monitor page to the add instrument page", () => {
    expect(uiHtml).toContain('href="/instruments/new"');
  });
});

// Exercise the delivered inline script so navigation and template syntax are checked together.
describe("landing page flow", () => {
  it("keeps controls on the landing page and details on their own page", () => {
    expect(uiHtml).toContain('<h2>Run</h2>');
    expect(uiHtml).toContain('Latest analysis results');
    expect(uiHtml).not.toContain('<h2>Signals</h2>');
    expect(analysisHtml).toContain('<h2>Signals</h2>');
    expect(analysisHtml).toContain('href="/"');
    expect(analysisHtml).not.toContain('<h2>Run</h2>');
    for (const html of [uiHtml, analysisHtml]) {
      expect(() => new Script(html.match(/<script>([\s\S]*?)<\/script>/)![1]!)).not.toThrow();
    }
  });

  it("loads all latest results and navigates after a successful analysis", async () => {
    const nodes = new Map<string, any>();
    const node = () => ({ value: "SPY", children: [] as any[], style: {}, append(child: any) { this.children.push(child); }, replaceChildren(...children: any[]) { this.children = children; } });
    for (const id of ["import", "analyze", "latest", "message", "symbol", "results", "token-bar", "token-fill", "token-label", "from", "to"]) nodes.set(id, node());
    const location = { search: "", href: "" };
    const fetch = vi.fn(async (path: string) => ({ ok: true, status: 200, json: async () => {
      if (path === "/api/v1/instruments") return [{ symbol: "SPY", name: "S&P 500" }];
      if (path === "/api/v1/analyses/latest") return [{ symbol: "SPY", name: "S&P 500", analysis: null }];
      return {};
    } }));
    runInNewContext(uiHtml.match(/<script>([\s\S]*?)<\/script>/)![1]!, {
      document: { getElementById: (id: string) => nodes.get(id), createElement: node },
      location, fetch, URLSearchParams, setInterval: () => 0,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/v1/analyses/latest", { method: "GET" }));
    nodes.get("analyze").onclick();
    await vi.waitFor(() => expect(location.href).toBe("/analysis?symbol=SPY"));
    expect(fetch).toHaveBeenCalledWith("/api/v1/instruments/SPY/analyze", { method: "POST" });
  });
});
