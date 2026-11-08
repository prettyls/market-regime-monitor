import { describe, expect, it } from "vitest";
import { newInstrumentHtml } from "../src/web/new-instrument.js";
import { uiHtml } from "../src/web/ui.js";

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
