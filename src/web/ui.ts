import { baseStyles } from "./styles.js";

// Served as a single self-contained page so the compiled build needs no static asset copy step.
// The inline script must avoid template literals: this whole document is a TypeScript template string.
export const uiHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Market Regime Monitor</title>
<style>
${baseStyles}
  .summary { display: flex; flex-wrap: wrap; gap: 24px; align-items: center; }
  .badge { padding: 10px 20px; border-radius: 999px; color: #fff; font-weight: 700; letter-spacing: 0.05em; }
  .badge.NORMAL { background: var(--normal); }
  .badge.WARNING { background: var(--warning); }
  .badge.ALERT { background: var(--alert); }
  .metric { display: grid; gap: 2px; }
  .metric span:first-child { font-size: 12px; color: var(--muted); }
  .metric span:last-child { font-size: 18px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; }
  ul { margin: 0; padding-left: 20px; }
  .bullish { color: var(--normal); }
  .bearish { color: var(--alert); }
  .empty { color: var(--muted); font-size: 14px; }
  .legend { display: flex; gap: 16px; font-size: 12px; color: var(--muted); }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
</style>
</head>
<body>
<header><h1>Market Regime Monitor</h1><a href="/instruments/new">Add instrument</a></header>
<main>
  <section>
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
  </section>
  <section>
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
  </section>
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var buttons = ["import", "analyze", "latest"].map($);

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) { node[key] = props[key]; });
    (children || []).forEach(function (child) { node.append(child); });
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

  async function run(label, action) {
    buttons.forEach(function (b) { b.disabled = true; });
    setMessage(label + "...");
    try { setMessage(await action()); }
    catch (error) { setMessage(label + " failed: " + error.message, true); }
    finally { buttons.forEach(function (b) { b.disabled = false; }); }
  }

  function table(headers, rows) {
    return el("table", {}, [
      el("thead", {}, [el("tr", {}, headers.map(function (h) { return el("th", { textContent: h }); }))]),
      el("tbody", {}, rows.map(function (cells) { return el("tr", {}, cells.map(function (c) { return el("td", { textContent: c }); })); }))
    ]);
  }

  function metric(name, value) { return el("div", { className: "metric" }, [el("span", { textContent: name }), el("span", { textContent: value })]); }

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
      el("span", { className: "badge " + analysis.status, textContent: analysis.status }),
      metric("Regime", analysis.regime),
      metric("Score", fmt(analysis.score)),
      metric("Confidence", fmt(analysis.confidence) + "%"),
      metric("As of", date(analysis.timestamp))
    );
    var signals = analysis.signals || [];
    $("signals").className = "";
    $("signals").replaceChildren(signals.length ? table(["Pattern", "State", "Score", "Confidence"], signals.map(function (s) {
      return [s.pattern, s.state, fmt(s.score), fmt(s.confidence) + "%"];
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
      return [date(a.timestamp), a.severity, (a.fromRegime || "unclassified") + " to " + a.toRegime, fmt(a.score)];
    })) : "No alerts.");
  }

  async function loadLatest() {
    var analysis = await api("GET", "/api/v1/instruments/" + symbol() + "/analysis");
    render(analysis);
    await loadAlerts();
    return analysis ? "Loaded latest analysis." : "No stored analysis for this instrument.";
  }

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
      render(await api("POST", "/api/v1/instruments/" + symbol() + "/analyze"));
      await loadAlerts();
      return "Analysis complete.";
    });
  };
  $("latest").onclick = function () { run("Loading", loadLatest); };
  $("symbol").onchange = function () { run("Loading", loadLatest); };

  run("Loading instruments", async function () {
    var instruments = await api("GET", "/api/v1/instruments");
    $("symbol").replaceChildren.apply($("symbol"), instruments.map(function (i) { return el("option", { value: i.symbol, textContent: i.symbol + " - " + i.name }); }));
    if (!instruments.length) return "No instruments configured. Use Add instrument to create one.";
    var requested = new URLSearchParams(location.search).get("symbol");
    if (requested && instruments.some(function (i) { return i.symbol === requested.toUpperCase(); })) $("symbol").value = requested.toUpperCase();
    return loadLatest();
  });
})();
</script>
</body>
</html>
`;
