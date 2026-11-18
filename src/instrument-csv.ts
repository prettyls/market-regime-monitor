export type WatchlistEntry = { symbol: string; name: string };
type ImportKind = "EQUITY" | "ETF";

const badCsv = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

function parseCsv(input: string): string[][] {
  const csv = input.replace(/^\uFEFF/, "");
  const field = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r\n|[\r\n]|$)/y;
  const rows: string[][] = [];
  let row: string[] = [];
  let position = 0;
  while (position < csv.length) {
    field.lastIndex = position;
    const match = field.exec(csv);
    if (!match) throw badCsv(`Malformed CSV at record ${rows.length + 1}`);
    position = field.lastIndex;
    row.push(match[1]?.replace(/""/g, '"') ?? match[2]!);
    if (match[3] === "," && position < csv.length) continue;
    if (match[3] === ",") row.push("");
    rows.push(row);
    row = [];
  }
  return rows;
}

function parseSchwabWatchlist(csv: string): WatchlistEntry[] {
  const [header, ...rows] = parseCsv(csv);
  const columns = header?.map((name) => name.trim().toLowerCase());
  const index = columns?.indexOf("symbol") ?? -1;
  if (index < 0 || index !== columns?.lastIndexOf("symbol")) {
    throw badCsv("Schwab CSV must contain exactly one Symbol column");
  }
  const entries = rows.flatMap((row, i) => {
    if (row.every((value) => !value.trim())) return [];
    const value = row[index] ?? "";
    const separator = value.indexOf(",");
    const symbol = value.slice(0, separator).trim().toUpperCase();
    const name = value.slice(separator + 1).trim();
    if (row.length !== header!.length || separator < 0 || !/^[A-Z0-9][A-Z0-9.\-/]{0,29}$/.test(symbol) || !name || name.includes("\0")) {
      throw badCsv(`Invalid Schwab CSV record ${i + 2}. Expected a Symbol value formatted as "ticker, name".`);
    }
    return [{ symbol, name }];
  });
  if (!entries.length) throw badCsv("CSV contains no instruments");
  return entries;
}

export const instrumentCsvFormats = new Map([
  ["charles_schwab", { label: "Charles Schwab", parse: parseSchwabWatchlist }],
]);

const shareDescription = /\b(?:(?:common|ordinary|preferred) (?:stock|shares?)|new york registry shares?)\s*$|\bamerican deposit[ao]ry (?:shares?|receipts?)\b/i;
const otherSecurity = /\b(?:notes?|warrants?|rights?|units?)\b/i;

const directories = [
  ["nasdaqlisted.txt", ["Symbol"]],
  ["otherlisted.txt", ["ACT Symbol", "CQS Symbol", "NASDAQ Symbol"]],
] as const;

export async function lookupWatchlistKinds(entries: WatchlistEntry[], fetchDirectory = fetch) {
  const requested = new Map(entries.map((entry) => [entry.symbol, entry]));
  const lookups = await Promise.allSettled(directories.map(async ([file, symbolColumns]) => {
    const response = await fetchDirectory(`https://www.nasdaqtrader.com/dynamic/SymDir/${file}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Nasdaq Trader directory unavailable");
    const [header, ...rows] = (await response.text()).split(/\r?\n/);
    const columns = header!.split("|");
    const etf = columns.indexOf("ETF");
    const test = columns.indexOf("Test Issue");
    const name = columns.indexOf("Security Name");
    const symbols = symbolColumns.map((column) => columns.indexOf(column));
    if ([etf, test, name, ...symbols].includes(-1)) throw new Error("Unexpected Nasdaq Trader directory format");
    const kinds = new Map<string, ImportKind>();
    for (const row of rows) {
      const fields = row.split("|");
      if (fields[test] !== "N") continue;
      const listing = fields[name] ?? "";
      // A non-ETF listing may be a warrant, right, unit, note, or other security.
      for (const column of symbols) {
        const symbol = fields[column]?.toUpperCase() ?? "";
        const entry = requested.get(symbol);
        if (!entry) continue;
        if (fields[etf] === "Y") kinds.set(symbol, "ETF");
        if (fields[etf] === "N" && !otherSecurity.test(listing) &&
          (shareDescription.test(listing) || /\bADR$/i.test(entry.name))) {
          kinds.set(symbol, "EQUITY");
        }
      }
    }
    return kinds;
  }));
  const kinds = new Map<string, ImportKind>();
  for (const result of lookups) {
    if (result.status === "fulfilled") {
      for (const [symbol, kind] of result.value) kinds.set(symbol, kind);
    }
  }
  return { kinds, incomplete: lookups.some((result) => result.status === "rejected") };
}
