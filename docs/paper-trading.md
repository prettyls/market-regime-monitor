# Scheduled AI paper trading

This workflow tests agent-directed long-only equity/ETF allocation with a
persistent simulated portfolio. It never submits, changes or cancels Schwab
orders. Results are hypothetical; no profitability is established.

## Daily workflow (America/New_York)

| Time | Cloud Run job | Action |
| --- | --- | --- |
| 07:30 weekdays | `market-regime-monitor-daily` | Collect previous trading-session bars, analyze, then request an AI allocation |
| 09:35 weekdays | `market-regime-monitor-paper-execute` | Execute today's saved decision against fresh bid/ask quotes in the paper ledger |
| 16:15 weekdays | `market-regime-monitor-paper-report` | Import closing bars and save performance versus the benchmark |

The enabled workflow checks Schwab's equity calendar and skips holidays. The
previous session is calendar-derived, including after a holiday. The execution
job rechecks actual regular-session boundaries, including early closes. The
closing report uses completed daily closing bars, not after-hours prices. If
closing bars are not available yet, reporting fails rather than estimating;
retry that report later. No automatic broker execution exists.

Planning runs inside the daily job, after collection and analysis succeed. Any
collection failure blocks the agent. Every target requires fresh analysis for
the expected previous session; zero-row imports or insufficient data block it.
A saved run contains exact analysis/instrument snapshots, paper account state,
policy, model identifier, decision and execution assumptions. The API key is
never included. This sends simulated account holdings and saved market analyses
to the configured OpenAI model. Actual Schwab accounts are not sent.

## Local setup

1. Run `npm run db:generate` and `npm run db:deploy`.
2. Register active `EQUITY`/`ETF` target instruments and a benchmark instrument.
   Import enough daily history for usable analysis.
3. Add the settings from `.env.example` to `.env`. Set `enabled` to `true` only
   for the paper account you want to test. Configure `OPENAI_API_KEY` and
   `PAPER_AGENT_MODEL` to a Responses API model supporting structured output.
   This is an API integration; it does not use Codex login or a desktop session.
4. Configure market app credentials (`SCHWAB_MARKET_*`) with real-time quotes
   entitlement. Trading app credentials are not needed by this workflow.

Commands (require a real current session; they do not bypass session checks):

```bash
npm run daily -- --last-day
npm run paper:execute
npm run paper:report
```

The separate `npm run collect` command remains a research collector and never
invokes the agent. Planning can incur OpenAI API usage charges. Missing keys,
refusals, invalid JSON or policy violations result in a FAILED plan and no fills.

The market reader retries a 401 once after refreshing with market client/refresh
credentials. Refreshed tokens are retained only in that job's process. Expired or
revoked refresh authorization needs manual renewal and deployment updates;
central durable token rotation is still future work. No token from the trading
namespace is substituted. Repeated authorization failures stop the workflow.

## Portfolio and risk behavior

The agent chooses HOLD or a complete set of target allocation weights.
Unallocated value remains cash. There is no requirement to trade each day. The
server validates symbol coverage, total allocation, and per-position targets.
Execution rejects policy changes after planning and targets that are no longer
active EQUITY/ETF instruments. It uses current paper holdings, sells before
buying, does not short, and limits each order and total daily turnover. It
includes configurable per-order fees and adverse slippage over bid/ask. Prices
and cash accounting use Decimal with four decimal places.

BUY fills use ask plus slippage; SELL fills use bid minus slippage. Whole-share
quantities can be clipped by limits, leaving an allocation partly implemented.
It does not retry repeatedly to reach a target. HOLD produces no fills. This is
an immediate hypothetical-fill model; liquidity, queue position, actual limit
order fills, dividends, taxes, interest and corporate actions are not modeled.
Stop the experiment and reconcile/reset accounts around unsupported splits.

`PaperAccount` holds cash and positions with total cost basis. `PaperFill` records
simulated buys/sells and fees. `PaperRun` records decisions and executions.
`PaperReport` records equity, realized/unrealized P&L, fees, total return and
buy-and-hold benchmark return from the first execution's midpoint. These are
since-inception measures, not annualized or risk-adjusted returns. Gross turnover
includes sells and buys; no real buying power is used.

Only one plan is permitted per account and Eastern session, even if strategy
names change. Retries reuse the saved decision; execution checks and applies
ledger changes in one transaction under an account lock. Repeated executions do
not create duplicate fills. Reports are immutable per account/session. A FAILED
or abandoned PLANNING run is never automatically regenerated; inspect it and
wait for the next session, or use a new paper account for a fresh experiment.
Changing initial cash or benchmark requires a new account ID. Keep held symbols
in policy until positions are exited. Run one experiment per account; do not
switch configuration between jobs.

`PAPER_TRADING_JSON` is the policy for this separate ledger. The existing
`TRADING_POLICY_JSON` applies to standalone simulated proposals and does not
pause the scheduled paper workflow. Set paper `enabled:false` consistently on
all three jobs to pause it. This is startup configuration, not an instant kill
switch. Existing `/trade-proposals` simulations are not ledger fills.

## Cloud deployment

The normal deployment script now deploys the updated daily job plus the two
paper jobs and weekday schedulers. All paper behavior defaults to disabled.
Nothing in a local `.env` is automatically uploaded. Deploy the application and
migration using the existing [Cloud Run instructions](cloud-run.md).

Create Secret Manager secrets for the JSON paper policy and OpenAI key, and grant
all relevant job runtime service accounts secret accessor permission on the
secrets they use. Do not put API keys in scripts or commit policy secrets.
Configure the already-created jobs using secret *names*, not secret values:

```bash
export PROJECT_ID='your-project'
export REGION='us-east4'
export PAPER_CONFIG_SECRET='paper-trading-config'
export OPENAI_KEY_SECRET='paper-agent-openai-key'
export PAPER_AGENT_MODEL='YOUR_SUPPORTED_MODEL_ID'
bash scripts/configure-paper-trading.sh
```

The helper binds paper config to all three jobs and the OpenAI key/model only to
the daily planning job. It does not execute them. Bind database access to every
job (`DATABASE_SECRET` on deployment), and push market credentials to the newly
created paper jobs using `scripts/update-cloud-run-tokens.sh`. Subsequent deploys
preserve these environment variables and secret bindings. No deployment or
secret upload is performed merely by building this code.

The jobs are protected by Cloud Run IAM; only authorized job invokers can run
them. No public trigger endpoint is added. The existing admin-only scoped agent
API exposes `GET /api/v1/agent/portfolio/paper` to `portfolio:read` credentials;
MCP exposes it as `get_paper_portfolio`. It includes account state, the most
recent 20 runs and 20 reports. These are separate from real broker holdings.

## Verification

```bash
npm test
npm run lint
npm run build
```

Tests cover allocation limits, cash reserve, sells/cost basis, turnover,
calendar/quote validation, structured agent responses, collection failure gates,
plan replay, single execution, failed decisions and report persistence. External
OpenAI/Schwab calls are mocked in automated tests. Validate with a small paper
account over multiple market sessions before drawing performance conclusions.

## Performance-driven review

Optional [rule and skill reviews](rule-reviews.md) run after closing reports.
They record candidate revisions when results miss configured expectations;
activation requires separate validation and administrator review. They are
disabled by default. The report job now also needs the OpenAI secret/model when
reviews are enabled; `configure-paper-trading.sh` binds these, and optionally
binds `PAPER_REVIEW_JSON` through `PAPER_REVIEW_SECRET`.
