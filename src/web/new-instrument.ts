import { defaultPatternConfig } from "../config.js";
import { instrumentCsvFormats } from "../instrument-csv.js";
import { baseStyles } from "./styles.js";

const kinds = ["INDEX", "ETF", "EQUITY", "RATE", "COMMODITY", "OTHER"];

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const options = (values: readonly string[]) => values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");

const csvProviders = (providers: readonly string[]) => providers.flatMap((provider) => {
  const format = instrumentCsvFormats.get(provider);
  return format ? [`<option value="${escapeHtml(provider)}">${escapeHtml(format.label)}</option>`] : [];
}).join("");

function csvImportSection(providers: readonly string[]) {
  const choices = csvProviders(providers);
  return `<section>
    <h2>Import instruments from CSV</h2>
    ${choices ? `<form id="csv-form">
      <label>Data provider <select id="csv-provider" required><option value="">Select a provider</option>${choices}</select></label>
      <label>Watchlist CSV <input id="csv-file" type="file" accept=".csv,text/csv" required></label>
      <p class="hint">For Charles Schwab exports, the Symbol column must contain a ticker and name. The import skips existing symbols and reports any it cannot identify as stocks or ETFs.</p>
      <div class="controls"><button id="csv-submit" type="submit">Import CSV</button></div>
    </form>
    <p id="csv-message" role="status" style="white-space: pre-line"></p>` : "<p>CSV import is unavailable for the configured data provider.</p>"}
  </section>`;
}

// The inline script must avoid template literals: this whole document is a TypeScript template string.
export const newInstrumentHtml = (providers: readonly string[]) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Add instrument - Market Regime Monitor</title>
<style>
${baseStyles}
  form { display: grid; gap: 12px; max-width: 520px; }
  textarea { font-family: ui-monospace, monospace; font-size: 13px; min-height: 260px; }
  details summary { cursor: pointer; font-size: 14px; color: var(--muted); }
  .hint { font-size: 12px; color: var(--muted); margin: 0; }
</style>
</head>
<body>
<header><h1>Market Regime Monitor</h1><a href="/">Back to monitor</a></header>
<main>
  <section>
    <h2>Add instrument</h2>
    <form id="form">
      <label>Symbol <input id="symbol" required maxlength="30" placeholder="SPX"></label>
      <label>Name <input id="name" required placeholder="S&amp;P 500 Index"></label>
      <label>Kind <select id="kind">${options(kinds)}</select></label>
      <label>Provider <select id="provider">${options(providers)}</select></label>
      <label>Provider symbol <input id="providerSymbol" placeholder="Defaults to the symbol"></label>
      <p class="hint">The ticker the data provider expects. Schwab indices are stored as $SPX or $VIX when this is left blank.</p>
      <details>
        <summary>Pattern config (optional)</summary>
        <label>JSON <textarea id="config">${escapeHtml(JSON.stringify(defaultPatternConfig, null, 2))}</textarea></label>
      </details>
      <div class="controls"><button id="submit" type="submit">Add instrument</button></div>
    </form>
    <p id="message"></p>
  </section>
  ${csvImportSection(providers)}
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  function setMessage(text, isError) { $("message").textContent = text; $("message").className = isError ? "error" : ""; }

  var csvForm = $("csv-form");
  if (csvForm) csvForm.onsubmit = async function (event) {
    event.preventDefault();
    var file = $("csv-file").files[0];
    var message = $("csv-message");
    $("csv-submit").disabled = true;
    message.className = "";
    message.textContent = "Checking and importing instruments…";
    try {
      var response = await fetch("/api/v1/instruments/import-csv", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: $("csv-provider").value, csv: await file.text() })
      });
      var body = await response.json().catch(function () { return null; });
      if (response.status === 413) throw new Error("The CSV is too large. Split it into smaller files with the same header.");
      if (!response.ok) throw new Error((body && body.message) || response.statusText);
      var lines = ["Added " + body.added.length + " instrument(s)."];
      if (body.added.length) lines.push(body.added.map(function (entry) { return entry.symbol + " (" + entry.kind + ")"; }).join(", "));
      if (body.existing.length) lines.push("Already configured: " + body.existing.join(", "));
      if (body.unresolved.length) lines.push("Could not confirm an equity or ETF: " + body.unresolved.join(", "));
      if (body.lookupIncomplete) lines.push("One or more listing directories were unavailable. Retry to check any unresolved symbols.");
      message.textContent = lines.join("\\n");
    } catch (error) {
      message.className = "error";
      message.textContent = "Import failed: " + error.message;
    } finally {
      $("csv-submit").disabled = false;
    }
  };

  $("form").onsubmit = async function (event) {
    event.preventDefault();
    var symbol = $("symbol").value.trim().toUpperCase();
    var config;
    try { config = JSON.parse($("config").value); }
    catch (error) { setMessage("Pattern config is not valid JSON: " + error.message, true); return; }
    $("submit").disabled = true;
    setMessage("Saving...");
    try {
      var existing = await fetch("/api/v1/instruments").then(function (r) { return r.json(); });
      if (existing.some(function (i) { return i.symbol === symbol; }) && !confirm(symbol + " already exists. Overwrite its settings?")) { setMessage(""); return; }
      var response = await fetch("/api/v1/instruments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: symbol, name: $("name").value.trim(), kind: $("kind").value, provider: $("provider").value, providerSymbol: $("providerSymbol").value.trim() || symbol, config: config })
      });
      var body = await response.json().catch(function () { return null; });
      if (!response.ok) throw new Error((body && body.message) || response.statusText);
      location.href = "/?symbol=" + encodeURIComponent(body.symbol);
    } catch (error) {
      setMessage("Add failed: " + error.message, true);
    } finally {
      $("submit").disabled = false;
    }
  };
})();
</script>
</body>
</html>
`;
