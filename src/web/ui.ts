import { financialGlossary } from "./glossary.js";
import { baseStyles } from "./styles.js";

// Served as a single self-contained page so the compiled build needs no static asset copy step.
// The inline script must avoid template literals: this whole document is a TypeScript template string.
const monitorHtml = (details: boolean) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Market Regime Monitor</title>
<style>
${baseStyles}
  .disclaimer { color: var(--muted); font-size: 12px; line-height: 1.6; }
  .financial-term { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
  .financial-term:focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; }
  .summary { display: flex; flex-wrap: wrap; gap: 24px; align-items: center; }
  .badge { padding: 10px 20px; border-radius: 999px; color: #fff; font-weight: 700; letter-spacing: 0.05em; }
  .badge.NORMAL { background: var(--normal); }
  .badge.WARNING { background: var(--warning); }
  .badge.ALERT { background: var(--alert); }
  .metric { display: grid; gap: 2px; }
  .metric span:first-child { font-size: 12px; color: var(--muted); }
  .metric span:last-child { font-size: 18px; font-weight: 600; }
  .table-scroll { overflow-x: auto; }
  .kind-panel { border: 1px solid var(--border); border-radius: 6px; margin-top: 12px; overflow: hidden; }
  .kind-panel summary { display: flex; gap: 10px; align-items: center; padding: 12px; cursor: pointer; font-size: 14px; font-weight: 600; list-style: none; }
  .kind-panel summary::-webkit-details-marker { display: none; }
  .kind-panel summary::before { content: "+"; display: inline-flex; justify-content: center; align-items: center; width: 18px; height: 18px; border: 1px solid var(--border); border-radius: 4px; font-weight: 500; }
  .kind-panel[open] > summary::before { content: "−"; }
  .kind-panel summary:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
  .kind-panel .table-scroll { padding: 0 12px 12px; min-height: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; }
  ul { margin: 0; padding-left: 20px; }
  .bullish { color: var(--normal); }
  .bearish { color: var(--alert); }
  .empty { color: var(--muted); font-size: 14px; }
  .legend { display: flex; gap: 16px; font-size: 12px; color: var(--muted); }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  #token-bar { position: relative; height: 28px; background: #d1d5db; overflow: hidden; }
  #token-bar[hidden] { display: none; }
  #token-fill { position: absolute; inset: 0 auto 0 0; width: 0; background: var(--muted); transition: width 1s linear, background-color 0.3s; }
  #token-fill.ok { background: var(--normal); }
  #token-fill.low { background: var(--warning); }
  #token-fill.critical { background: var(--alert); }
  #token-label { position: relative; display: block; line-height: 28px; text-align: center; font-size: 13px; font-weight: 600; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
</style>
</head>
<body>
<div id="token-bar" hidden role="progressbar" aria-label="Access token time remaining"><div id="token-fill"></div><span id="token-label"></span></div>
<header><h1>Market Regime Monitor</h1>${details ? '<a href="/">Back to monitor</a>' : '<a href="/instruments/new">Add instrument</a>'}</header>
<main>
  ${details ? '<section><h2 id="instrument-heading">Analysis details</h2><p id="message"></p><select id="symbol" hidden></select></section>' : `<section>
    <h2>Run</h2>
    <div class="controls">
      <label>Instrument <select id="symbol"></select></label>
      <label>From <input type="date" id="from"></label>
      <label>To <input type="date" id="to"></label>
      <button id="import" class="secondary">Import data</button>
      <button id="analyze">Run analysis</button>
      <button id="latest" class="secondary">Load latest</button>
    </div>
    <p id="message"></p>
  </section>`}
  ${details ? `<section>
    <h2>Analysis result</h2>
    <div id="summary" class="empty">No analysis loaded.</div>
    <div class="legend" style="margin-top:12px">
      <span><span class="dot" style="background:var(--normal)"></span>Normal: no breakout or trend</span>
      <span><span class="dot" style="background:var(--warning)"></span>Warning: trend up or down</span>
      <span><span class="dot" style="background:var(--alert)"></span>Alert: confirmed breakout</span>
    </div>
  </section>
  <section>
    <h2>Signals</h2>
    <div id="signals" class="empty">No signals.</div>
  </section>
  <section>
    <h2>Evidence</h2>
    <div id="evidence" class="empty">No evidence.</div>
  </section>
  <section>
    <h2>Recent alerts</h2>
    <div id="alerts" class="empty">No alerts.</div>
  </section>` : '<section><h2>Latest analysis results</h2><div id="results" class="table-scroll" aria-live="polite">Loading latest results...</div></section>'}
  ${details ? "" : `<footer class="disclaimer" aria-label="Disclaimer">
    <p>This Market Regime Monitor is for personal use and is provided under the MIT License. It is provided “as is”, without warranty of any kind. The information is for informational purposes only and does not constitute financial or investment advice. You are solely responsible for your investment decisions and assume all associated risks. The authors and contributors accept no liability for any losses or damages arising from its use.</p>
  </footer>`}
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var details = ${details};
  var buttons = ["import", "analyze", "latest"].map($).filter(Boolean);

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) { node[key] = props[key]; });
    (children || []).forEach(function (child) { node.append(child); });
    return node;
  }
  var glossary = ${JSON.stringify(financialGlossary)};
  function term(value) {
    var text = String(value);
    var key = text.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(glossary, key)) return text;
    var node = el("span", { className: "financial-term", textContent: text, title: glossary[key], tabIndex: 0 });
    node.setAttribute("aria-label", text + ": " + glossary[key]);
    return node;
  }
  function setMessage(text, isError) { $("message").textContent = text; $("message").className = isError ? "error" : ""; }
  function fmt(value) { return typeof value === "number" ? value.toFixed(2) : String(value); }
  function date(value) { return value ? new Date(value).toISOString().slice(0, 10) : "-"; }
  function symbol() { return encodeURIComponent($("symbol").value); }

  async function api(method, path) {
    var response = await fetch(path, { method: method });
    var body = response.status === 204 ? null : await response.json().catch(function () { return null; });
    if (!response.ok) throw new Error((body && body.message) || response.statusText);
    return body;
  }

  // Access token expiry countdown. The server reports expiresAt from the token response; the bar ticks locally between polls.
  var tokenExpiry = null;
  var tokenLifetimeMs = null;

  function formatRemaining(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return (h ? h + ":" + pad(m) : m) + ":" + pad(s);
  }

  function paintTokenBar() {
    var fill = $("token-fill"), label = $("token-label"), bar = $("token-bar");
    if (tokenExpiry === null) {
      fill.style.width = "0";
      fill.className = "";
      label.textContent = "Access token expiry unknown until the next token refresh";
      label.style.color = "#111827";
      label.style.textShadow = "none";
      return;
    }
    label.style.color = "";
    label.style.textShadow = "";
    var remaining = tokenExpiry - Date.now();
    var fraction = remaining > 0 && tokenLifetimeMs ? Math.min(1, remaining / tokenLifetimeMs) : 0;
    fill.style.width = (remaining > 0 ? Math.max(fraction, 0.01) * 100 : 100) + "%";
    fill.className = remaining <= 0 || fraction <= 0.1 ? "critical" : fraction <= 0.33 ? "low" : "ok";
    label.textContent = remaining > 0
      ? "Access token expires in " + formatRemaining(remaining) + " (" + new Date(tokenExpiry).toLocaleTimeString() + ")"
      : "Access token expired" + " at " + new Date(tokenExpiry).toLocaleTimeString();
    bar.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
  }

  async function refreshTokenStatus() {
    try {
      var status = await api("GET", "/api/v1/auth/token-status");
      $("token-bar").hidden = !status.supported;
      tokenExpiry = status.expiresAt ? new Date(status.expiresAt).getTime() : null;
      tokenLifetimeMs = status.lifetimeSeconds ? status.lifetimeSeconds * 1000 : null;
      paintTokenBar();
    } catch (error) { /* keep the last known state; the next poll retries */ }
  }

  async function run(label, action) {
    buttons.forEach(function (b) { b.disabled = true; });
    setMessage(label + "...");
    try { setMessage(await action()); }
    catch (error) { setMessage(label + " failed: " + error.message, true); }
    finally { buttons.forEach(function (b) { b.disabled = false; }); refreshTokenStatus(); }
  }

  setInterval(paintTokenBar, 1000);
  setInterval(refreshTokenStatus, 30000);

  function table(headers, rows) {
    return el("table", {}, [
      el("thead", {}, [el("tr", {}, headers.map(function (h) { return el("th", {}, [term(h)]); }))]),
      el("tbody", {}, rows.map(function (cells) { return el("tr", {}, cells.map(function (c) { return el("td", {}, [c]); })); }))
    ]);
  }

  function metric(name, value) { return el("div", { className: "metric" }, [el("span", {}, [term(name)]), el("span", {}, [term(value)])]); }

  function render(analysis) {
    if (!analysis) {
      $("summary").replaceChildren("No analysis found. Import data and run analysis.");
      $("summary").className = "empty";
      $("signals").replaceChildren("No signals.");
      $("evidence").replaceChildren("No evidence.");
      return;
    }
    $("summary").className = "summary";
    $("summary").replaceChildren(
      el("span", { className: "badge " + analysis.status, }, [term(analysis.status)]),
      metric("Regime", analysis.regime),
      metric("Score", fmt(analysis.score)),
      metric("Signal strength", fmt(analysis.confidence) + "%"),
      metric("As of", date(analysis.timestamp))
    );
    var signals = analysis.signals || [];
    $("signals").className = "";
    $("signals").replaceChildren(signals.length ? table(["Pattern", "State", "Score", "Strength", "Volume vs baseline", "ATR"], signals.map(function (s) {
      return [term(s.pattern), term(s.state), fmt(s.score), s.pattern === "volume" ? "—" : fmt(s.confidence) + "%", s.metrics && s.metrics.relativeVolume !== undefined ? fmt(s.metrics.relativeVolume) + "× latest / " + fmt(s.metrics.confirmationRatio) + "× confirmation" : "—", s.metrics && s.metrics.atr !== undefined ? fmt(s.metrics.atr) : "—"];
    })) : "No signals.");
    var evidence = analysis.evidence || [];
    $("evidence").className = evidence.length ? "" : "empty";
    $("evidence").replaceChildren(evidence.length ? el("ul", {}, evidence.map(function (e) {
      return el("li", { className: e.direction, textContent: e.message });
    })) : "No evidence.");
  }

  async function loadAlerts() {
    var alerts = await api("GET", "/api/v1/alerts?limit=10&symbol=" + symbol());
    $("alerts").className = alerts.length ? "" : "empty";
    $("alerts").replaceChildren(alerts.length ? table(["Date", "Severity", "Transition", "Score"], alerts.map(function (a) {
      return [date(a.timestamp), term(a.severity), el("span", {}, [term(a.fromRegime || "unclassified"), " to ", term(a.toRegime)]), fmt(a.score)];
    })) : "No alerts.");
  }

  async function loadLatest() {
    var analysis = await api("GET", "/api/v1/instruments/" + symbol() + "/analysis");
    render(analysis);
    await loadAlerts();
    return analysis ? "Loaded latest analysis." : "No stored analysis for this instrument.";
  }

  if (!details) {
  $("import").onclick = function () {
    run("Importing", async function () {
      var params = new URLSearchParams();
      if ($("from").value) params.set("from", $("from").value);
      if ($("to").value) params.set("to", $("to").value);
      var query = params.toString();
      var result = await api("POST", "/api/v1/instruments/" + symbol() + "/import" + (query ? "?" + query : ""));
      return "Imported " + result.imported + " bars.";
    });
  };
  $("analyze").onclick = function () {
    run("Analyzing", async function () {
      var selected = symbol();
      await api("POST", "/api/v1/instruments/" + selected + "/analyze");
      location.href = "/analysis?symbol=" + selected;
      return "Analysis complete.";
    });
  };
  $("latest").onclick = function () { location.href = "/analysis?symbol=" + symbol(); };
  }

  async function loadResults() {
    var instruments = await api("GET", "/api/v1/analyses/latest");
    var kinds = [["INDEX", "Indices"], ["ETF", "ETFs"], ["EQUITY", "Equities"], ["RATE", "Rates"], ["COMMODITY", "Commodities"], ["OTHER", "Other"]];
    var panels = kinds.map(function (kind) {
    var members = instruments.filter(function (i) { return i.kind === kind[0]; });
    var rows = members.map(function (i) {
      var a = i.analysis;
      return [el("a", { href: "/analysis?symbol=" + encodeURIComponent(i.symbol), textContent: i.symbol + " - " + i.name }), a ? term(a.status) : "Not analyzed", a ? term(a.regime) : "-", a ? fmt(a.score) : "-", a ? fmt(a.confidence) + "%" : "-", a ? date(a.timestamp) : "-"];
    });
    var content = el("div", { className: "table-scroll" }, rows.length ? [table(["Instrument", "Status", "Regime", "Score", "Signal strength", "As of"], rows)] : []);
    return el("details", { className: "kind-panel", open: true }, [el("summary", { textContent: kind[1] + " (" + members.length + ")" }), content]);
    });
    $("results").replaceChildren.apply($("results"), panels);
  }

  run("Loading instruments", async function () {
    var instruments = await api("GET", "/api/v1/instruments");
    $("symbol").replaceChildren.apply($("symbol"), instruments.map(function (i) { return el("option", { value: i.symbol, textContent: i.symbol + " - " + i.name }); }));
    if (!instruments.length) { if (!details) await loadResults(); buttons.forEach(function (b) { b.hidden = true; }); return "No instruments configured. Use Add instrument to create one."; }
    var requested = new URLSearchParams(location.search).get("symbol");
    if (requested && instruments.some(function (i) { return i.symbol === requested.toUpperCase(); })) $("symbol").value = requested.toUpperCase();
    if (details) {
      if (!requested || !instruments.some(function (i) { return i.symbol === requested.toUpperCase(); })) throw new Error("Select an instrument from the landing page.");
      $("instrument-heading").textContent = $("symbol").selectedOptions[0].textContent + " — Analysis details";
      return loadLatest();
    }
    await loadResults();
    return "Select an instrument to run analysis or open a result below.";
  });
})();
</script>
</body>
</html>
`;

export const uiHtml = monitorHtml(false);
export const analysisHtml = monitorHtml(true);
