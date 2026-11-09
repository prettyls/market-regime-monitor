# Market Regime Monitor

An API-first TypeScript service for importing market data through REST APIs, detecting configurable patterns, classifying market regimes, and emitting transition alerts. VIX is included as configuration—not embedded in the analysis logic—and any instrument supported by a proposition can use the same engine.

## Architecture

- **Instrument** describes the market series, provider symbol, and per-instrument pattern settings.
- **Pattern detectors** are pure calculations: dynamic percentile range, confirmed breakout, z-score mean reversion, and moving-average/slope trend.
- **Strategy** combines detector output into a regime, score, confidence, and traceable evidence.
- **Schwab API client** uses `@sudowealth/schwab-api` for typed Schwab market-data access.
- **Data-collection proposition** isolates broker/data-source integrations. Each proposition has its own API base URL. V1 includes Charles Schwab and Stooq.
- **Persistence and delivery** use PostgreSQL/Prisma, Fastify REST endpoints, a Commander CLI, and Pino logs.
- **Alerts** are generated only when the persisted regime changes. A unique transition key makes repeated analysis idempotent.

## Quick start

Requirements: Node.js 22+, npm, and Docker.
Environment variables are loaded automatically from `.env` at startup.

Environment:
- `DATA_PROVIDER` selects the collection proposition (`schawb` is the default; `stooq` is also supported).
- `SCHWAB_ACCESS_TOKEN` is required when the configured provider is Schwab.
- Optional automatic refresh variables:
  - `SCHWAB_REFRESH_TOKEN`
  - `CLIENT_ID`/`CLIENT_SECRET` (or `SCHWAB_CLIENT_ID`/`SCHWAB_CLIENT_SECRET`)
  - `SCHWAB_REDIRECT_URI` (defaults to `http://localhost`)
- API base URLs are resolved internally from proposition mappings.

### Schwab token setup and rotation

1. Create a Schwab developer app and complete OAuth authorization in your own token workflow.
2. Export the current access token into this service:

```bash
export SCHWAB_ACCESS_TOKEN="YOUR_CURRENT_ACCESS_TOKEN"
```

3. To enable automatic refresh, also configure:

```bash
export SCHWAB_REFRESH_TOKEN="YOUR_CURRENT_REFRESH_TOKEN"
export CLIENT_ID="YOUR_SCHWAB_APP_CLIENT_ID"
export CLIENT_SECRET="YOUR_SCHWAB_APP_CLIENT_SECRET"
```

4. Persist these values in your local `.env`, then restart long-running processes (`npm run dev`, API container, or scheduled jobs).

Notes:
- This service does not perform interactive login; you still need an initial token pair (`SCHWAB_ACCESS_TOKEN` + `SCHWAB_REFRESH_TOKEN`) from your OAuth workflow.
- When refresh is configured, the app refreshes the access token and keeps the `expires_in` value from Schwab's token response in memory for the running process.
- If refresh is not configured, rotate `SCHWAB_ACCESS_TOKEN` manually.

Quick token health check (minimal API call):

```bash
npm run cli -- import VIX --from 2024-01-02 --to 2024-01-02
```

If the token is invalid/expired and refresh is unavailable, the command fails with an auth/provider error. If it succeeds (including `imported: 0`), authentication is working and the request reached the provider.

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:generate
npm run db:deploy
npm run cli -- seed
npm run collect -- --symbol VIX --from 2020-01-01
npm run build
npm run start:api
```

The API listens on `http://localhost:3000`. Verify it with `GET /health`.

## Execution modes

| Mode | Command | Behavior |
|---|---|---|
| API | `npm run start:api` | Start the HTTP server from the compiled build; run `npm run build` first. |
| Collector | `npm run collect` | Import daily history and analyze each active instrument, then exit. `--last-day` imports only the previous weekday's bar. |
| Backtest | `npm run backtest` | Evaluate stored history for each active instrument, print results, then exit. |
| CLI | `npm run cli -- --help` | Show commands for instrument management, imports, analysis, and data inspection. |

All modes use the same database and instrument configuration. `npm start` is an alias for `start:api`; `npm run dev` starts the API with automatic reload. Collector, Backtest, and CLI run TypeScript directly and require development dependencies (`npm install`).

```bash
npm run collect
npm run collect -- --last-day
npm run collect -- --symbol VIX --from 2020-01-01 --to 2024-12-31
npm run backtest
npm run backtest -- --symbol VIX
npm run cli -- data --symbol VIX
```

Collector and Backtest default to all instruments marked `active`. `--symbol` selects one instrument explicitly, including an inactive instrument. Symbols are case-insensitive. Both jobs continue processing other instruments after a failure and exit with a nonzero status if any instrument fails. Neither job starts the API server.

Collector accepts optional inclusive `--from` and `--to` dates in `YYYY-MM-DD` format. Without dates it requests all history available from each configured proposition; imports upsert existing daily bars. `--last-day` requests only the previous weekday on the America/New_York calendar, which at 7:30am Eastern is the latest completed session, and cannot be combined with `--from` or `--to`. After a nonempty import it saves analysis of the newest 1,000 stored bars and creates any regime-transition alert. The date options limit the import, not the analysis window. A zero-row import skips analysis. Collection runs once. Cloud Run schedules `--last-day` every morning at 7:30am Eastern. Proposition access errors require resolving endpoint/credentials or adding another proposition.

Backtest reads stored bars without importing data or saving analyses or alerts. Import history first; results report observations and average next-bar returns by regime.

## CLI

```bash
npm run cli -- instruments
npm run cli -- instrument:add --symbol SPX --name "S&P 500" --provider-symbol ^SPX
npm run cli -- import SPX --from 2020-01-01
npm run cli -- data --symbol VIX
npm run cli -- data --symbol VIX --from 2024-01-01 --to 2024-12-31
npm run cli -- analyze SPX
npm run cli -- alerts --symbol SPX
npm run cli -- backtest SPX
```

`instrument:add` applies the default configuration. For custom thresholds, create an instrument through the API or edit its JSON configuration through your own administration layer.

`data` displays imported daily OHLC prices and volume in chronological order. `--symbol` is required and case-insensitive. Both `--from` and `--to` are optional inclusive UTC dates in `YYYY-MM-DD` format; omit either to leave that end of the range unbounded. With neither date, all stored daily bars for the symbol are shown. This command reads the database without fetching new data.

## REST API

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Web UI |
| GET | `/instruments/new` | Web UI form to add an instrument |
| GET | `/health` | Liveness check |
| GET/POST | `/api/v1/instruments` | List or configure instruments |
| POST | `/api/v1/instruments/:symbol/import?from=YYYY-MM-DD&to=YYYY-MM-DD` | Import/upsert history |
| GET | `/api/v1/instruments/:symbol/data` | Recent stored bars |
| POST | `/api/v1/instruments/:symbol/analyze` | Run and persist analysis/transition alert |
| GET | `/api/v1/instruments/:symbol/analysis` | Latest analysis |
| GET | `/api/v1/signals/:symbol` | Latest detector signals |
| GET | `/api/v1/alerts?symbol=VIX&severity=WARNING` | Query alerts |
| GET | `/api/v1/instruments/:symbol/backtest` | One-bar forward returns grouped by regime |

`POST .../analyze` and `GET .../analysis` also return a `status` and `color` derived from the breakout and trend detector signals:

| Status | Color | Condition |
|---|---|---|
| `ALERT` | red | Breakout confirmed up or down |
| `WARNING` | orange | Trend up or down, no confirmed breakout |
| `NORMAL` | green | No confirmed breakout and no trend |

## Web UI

Open `http://localhost:3000/` while the API is running. Select an instrument to load its latest analysis, then use **Import data** (optional from/to dates), **Run analysis**, or **Load latest** to call the API. The page shows the color-coded status, regime, score, confidence, detector signals, evidence, and recent alerts for the instrument.

Use **Add instrument** in the header (or open `http://localhost:3000/instruments/new`) to add an instrument. The form takes the symbol, name, kind, provider (only providers enabled by `DATA_PROVIDER` are listed), and provider symbol (defaults to the symbol), with an optional pattern config prefilled with the defaults. Saving an existing symbol asks for confirmation before overwriting it, and success returns to the monitor with the new instrument selected.

Example instrument body:

```json
{
  "symbol": "MOVE",
  "name": "ICE BofA MOVE Index",
  "kind": "INDEX",
  "provider": "charles_schwab",
  "providerSymbol": "$MOVE",
  "config": {
    "range": { "lookback": 60, "percentileLow": 0.2, "percentileHigh": 0.8 },
    "breakout": { "lookback": 20, "confirmationBars": 2, "bufferPct": 0.005 },
    "meanReversion": { "lookback": 30, "zScoreEntry": 2 },
    "trend": { "fastPeriod": 10, "slowPeriod": 30, "slopePeriod": 10 }
  }
}
```

Proposition coverage varies by symbol. A zero-row import can mean the configured proposition does not carry that series; add another proposition by implementing `MarketDataProvider` and registering it in `ProviderRegistry`.

## Docker and Cloud Run

Run PostgreSQL, migrations, and the containerized API locally:

```bash
docker compose -f docker-compose.yml -f compose.app.yml up --build -d
curl --fail http://localhost:8080/health
```

The production image supports all four modes. Cloud Run uses an API service plus Collector, daily-bar, Backtest, and seed jobs, with a migration job applied before deployment. The daily-bar job runs at 7:30am Eastern. A push to `main` runs the same Cloud Build release. See [Docker and Cloud Run deployment](docs/cloud-run.md) for image commands, AlloyDB and Secret Manager setup, and the trigger. The API requires authenticated Cloud Run access by default. A request to the `*.run.app` URL without a Google identity token returns 403 before it reaches the application.

Set `PROJECT_ID` and `REGION` to the Cloud Run service, then choose one of these setups before calling the API from Postman or another REST client. The caller account needs `roles/run.invoker` on the service.

Proxy the service to localhost. Leave this process running, and point the client at `http://localhost:8081`. The proxy attaches your gcloud credentials, so the client sends no auth header.

```bash
gcloud run services proxy market-regime-monitor \
  --project="$PROJECT_ID" --region="$REGION" --port=8081
```

Call the Cloud Run URL directly with a bearer token. In Postman, set Authorization to Bearer Token and paste the command output. The token expires after about one hour; run the command again and replace it.

```bash
gcloud auth print-identity-token
```

```bash
curl --fail --location "https://market-regime-monitor-PROJECT_NUMBER.${REGION}.run.app/api/v1/instruments" \
  --header "Authorization: Bearer $(gcloud auth print-identity-token)"
```

Use the service URL from `gcloud run services describe market-regime-monitor --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)'`. The Schwab access and refresh tokens configure market-data collection on the server. They do not authorize calls to this API.

## Development

```bash
npm test
npm run lint
npm run build
npm run db:migrate -- --name your_change
```

## Backtesting and extension points

The initial backtest intentionally reports observations and average next-bar return by classified regime. It is a hypothesis-evaluation baseline, not a trading-performance claim. Static claims such as “VIX 12–16 predicts reversal” are not encoded; ranges are rolling percentiles and all settings are instrument configuration.

Future confirmation data (VIX futures term structure, VVIX, related instruments) can be added as provider-fed series and consumed by a new `Strategy` implementation. A future web UI can consume the existing REST representation without changing analysis logic.

Market data can be delayed or incomplete. This software is for research, not investment advice.
