# Market Regime Monitor

An API-first TypeScript service for importing delayed/public market data, detecting configurable patterns, classifying market regimes, and emitting transition alerts. VIX is included as configuration—not embedded in the analysis logic—and any instrument supported by a provider can use the same engine.

## Architecture

- **Instrument** describes the market series, provider symbol, and per-instrument pattern settings.
- **Pattern detectors** are pure calculations: dynamic percentile range, confirmed breakout, z-score mean reversion, and moving-average/slope trend.
- **Strategy** combines detector output into a regime, score, confidence, and traceable evidence.
- **Provider** isolates licensed/public data access. V1 includes Stooq's public historical CSV endpoint; no site scraping is used.
- **Persistence and delivery** use PostgreSQL/Prisma, Fastify REST endpoints, a Commander CLI, and Pino logs.
- **Alerts** are generated only when the persisted regime changes. A unique transition key makes repeated analysis idempotent.

## Quick start

Requirements: Node.js 22+, npm, and Docker.

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:generate
npm run db:deploy
npm run cli -- seed
npm run cli -- import VIX --from 2020-01-01
npm run cli -- analyze VIX
npm run dev
```

The API listens on `http://localhost:3000`. Verify it with `GET /health`.

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
| GET | `/health` | Liveness check |
| GET/POST | `/api/v1/instruments` | List or configure instruments |
| POST | `/api/v1/instruments/:symbol/import?from=YYYY-MM-DD&to=YYYY-MM-DD` | Import/upsert history |
| GET | `/api/v1/instruments/:symbol/data` | Recent stored bars |
| POST | `/api/v1/instruments/:symbol/analyze` | Run and persist analysis/transition alert |
| GET | `/api/v1/instruments/:symbol/analysis` | Latest analysis |
| GET | `/api/v1/signals/:symbol` | Latest detector signals |
| GET | `/api/v1/alerts?symbol=VIX&severity=WARNING` | Query alerts |
| GET | `/api/v1/instruments/:symbol/backtest` | One-bar forward returns grouped by regime |

Example instrument body:

```json
{
  "symbol": "MOVE",
  "name": "ICE BofA MOVE Index",
  "kind": "INDEX",
  "provider": "stooq",
  "providerSymbol": "^MOVE",
  "config": {
    "range": { "lookback": 60, "percentileLow": 0.2, "percentileHigh": 0.8 },
    "breakout": { "lookback": 20, "confirmationBars": 2, "bufferPct": 0.005 },
    "meanReversion": { "lookback": 30, "zScoreEntry": 2 },
    "trend": { "fastPeriod": 10, "slowPeriod": 30, "slopePeriod": 10 }
  }
}
```

Provider coverage varies by symbol. A zero-row import can mean the provider does not carry that series; add another permitted provider by implementing `MarketDataProvider` and registering it in `ProviderRegistry`.

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
