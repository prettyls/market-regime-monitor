# Agent trading: simulation milestone

The API supports authenticated agents reading analyses and Schwab portfolio data,
then submitting persisted hypothetical BUY limit orders. It never submits,
modifies, or cancels broker orders. No live execution worker or approval route is
implemented in this milestone.

## Setup

1. Run `npm run db:generate` and `npm run db:deploy` against your intended database.
2. Generate a random token, for example `openssl rand -hex 32`.
3. Set configuration below in your local environment or deployment secret store.
   Replace the example token with the generated value. Restart the API.

```dotenv
AGENT_CREDENTIALS_JSON='[{"id":"research-agent","token":"REPLACE_WITH_RANDOM_TOKEN_AT_LEAST_32_CHARACTERS","scopes":["analysis:read","portfolio:read","trades:propose"]}]'
TRADING_POLICY_JSON='{"version":"paper-v1","enabled":true,"allowedSymbols":["SPY"],"maxOrderDollars":1000,"maxDailyDollars":5000,"maxAnalysisAgeHours":96}'
```

Omitting credentials denies all access to the new endpoints. Omitting policy
configuration pauses proposals. Credentials must have unique IDs and tokens.
Policies and credentials are loaded at startup; restart every replica to change
them, including to pause proposals. This is not an immediate operational kill
switch for a future live trading system.

Use HTTPS outside localhost. All new endpoints require `Authorization: Bearer
<agent-token>`. Cloud Run IAM remains an additional access gate: use the existing
local authenticated proxy, or put the Google identity token in
`X-Serverless-Authorization` and the agent token in `Authorization`. Grant only
necessary scopes. Portfolio scope grants read access to all accounts linked to
the configured Schwab credentials; account-specific entitlements are future work.
Agents cannot update policy or obtain broker credentials through these routes.

## Endpoints

| Method | Path | Scope |
| --- | --- | --- |
| GET | `/api/v1/agent/context` | `analysis:read` |
| GET | `/api/v1/agent/portfolio/accounts` | `portfolio:read` |
| GET | `/api/v1/agent/portfolio/orders` | `portfolio:read` |
| POST | `/api/v1/trade-proposals` | `trades:propose` |
| GET | `/api/v1/trade-proposals/:id` | `trades:propose` |

Context includes the newest 100 analysis records, instrument identifiers, policy,
and simulation mode. It can contain multiple dates for an instrument; choose the
intended analysis ID. Portfolio accounts include positions and balances; orders
cover the trailing seven days. Schwab requests have a 15-second timeout, return
sanitized upstream errors, and use the current server access token. The existing
market-data provider can refresh that token during its own requests; portfolio
reads do not independently refresh it. Expired authorization requires renewal.

Example proposal body:

```json
{
  "analysisId": "ID_FROM_AGENT_CONTEXT",
  "strategyId": "regime-allocation-v1",
  "symbol": "SPY",
  "side": "BUY",
  "quantity": 1,
  "orderType": "LIMIT",
  "limitPrice": "100.00",
  "timeInForce": "DAY",
  "reason": "Illustrative allocation based on the selected analysis",
  "idempotencyKey": "research-agent-analysis123-spy-1"
}
```

Prices are illustrative. Only BUY, LIMIT, DAY, positive integer quantities and
prices with at most four decimal places are accepted. Extra fields are rejected.
The trading symbol must exist in the instrument registry with kind `EQUITY` or
`ETF`, as well as being allowed by policy. Unknown symbols and all other kinds
return 422. Register SPY as an ETF before running the example. The server checks
the target instrument independently of the source analysis and saves its
configuration in the proposal snapshot.
The source analysis can be a different instrument (e.g. VIX informing SPY).
Strategy ID and reason are recorded assertions, not validated trading logic.

New proposals return 201; identical retries return 200 with the original record.
Reusing a key with a different normalized request returns 409. A policy violation
returns 422. Unknown or another agent's proposal returns 404. Proposal records
include an immutable copy of analysis and instrument configuration, policy,
request, and simulation assumptions. Snapshot capture occurs within the same
transaction as proposal creation. A corresponding audit event is also persisted.
No update/delete endpoint is provided for these records.

The daily budget is shared across agents, resets at UTC midnight, and counts
hypothetical notional from all proposals. Transactions serialize budget checks
across replicas and retry serialization conflicts. Monetary calculations use
Decimal or integer ten-thousandths. Replayed requests consume no new budget,
even after the policy is paused.

## Simulation limitations and next phase

Simulation assumes execution at the submitted limit price. It does not validate
quotes, sessions, tradability, cash, liquidity, spread, fees or actual fills, and
is not a simulated portfolio ledger or strategy-performance backtest. Read-only
Schwab positions are never modified. A SIMULATED result is not a broker fill.

Before live execution, add centrally persisted and coordinated OAuth refresh,
account entitlements, validated strategy mappings, fresh quotes, portfolio
reservations, a paper portfolio ledger, human approval UI, immediate kill switch,
durable execution queue, broker reconciliation and uncertain-submission handling.
Add MCP as a wrapper over these same authenticated services when needed.
