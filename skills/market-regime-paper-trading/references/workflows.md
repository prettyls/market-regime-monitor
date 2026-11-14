# Tool workflows

All API-backed tools require a configured agent bearer credential with explicit
`role: "admin"` and the required scopes. A browser's Basic admin login is a
separate mechanism. Never read `.env` to recover secrets as part of a trading
review. Ask the operator to configure authentication when it is missing.

## Inspect the scheduled paper experiment

1. `get_paper_portfolio({})`: returns `policy`, `rules`, paper accounts, recent
   runs and closing reports. Select the requested account and session. Accounts
   contain cash and positions with total cost basis. Runs preserve the exact
   inputs, rule version, model decision and execution assumptions.
2. `get_trading_context({})`: returns standalone proposal policy and recent
   analyses. Its policy is `TRADING_POLICY_JSON`, whereas the paper portfolio's
   policy is `PAPER_TRADING_JSON`. They are separate. Find the intended symbol
   and date; confidence is a 0–100 heuristic strength measure.
3. Explain whether the scheduled decision is consistent with the saved rules.
   Scheduled allocation uses HOLD with no targets, or REBALANCE with exactly one
   weight for each configured symbol, including zeros for exits. Whole-share
   fills may leave actual allocations below targets because of order limits.

`get_portfolio({})` and `get_recent_orders({})` return actual Schwab accounts and
orders. Use them only when the user wants real-account inspection. Do not merge
these balances, orders or fills into paper performance.

Scheduled fills use fresh ask/bid plus adverse slippage during regular sessions;
closing reports use completed-session closes. A rejected/failed run is not a
completed rebalance. MCP cannot trigger those jobs or submit allocation plans.

## Test a standalone proposal

Confirm a user-authorized simulation, the specific target and a usable saved
analysis. Only registered EQUITY/ETF targets allowed by standalone policy work.
Choose quantity and limit within that policy and the user's bounds. Current
MCP tools do not provide a fresh executable quote; if the user did not supply
an illustrative limit or an independently verified price, ask for one rather
than presenting an old close as a live quote.

Example shape (substitute the actual authorized inputs):

```json
{
  "analysisId": "saved-analysis-id",
  "strategyId": "interactive-paper-test",
  "symbol": "SPY",
  "side": "BUY",
  "quantity": 1,
  "orderType": "LIMIT",
  "limitPrice": "100.00",
  "timeInForce": "DAY",
  "reason": "Illustrative simulation; cite actual evidence here",
  "idempotencyKey": "unique-decision-key"
}
```

The example price is not a market quote. Fetch the result using
`get_trade_proposal({"id":"returned-id"})` and report `SIMULATED` accurately.
Standalone proposals assume the submitted price and create no paper ledger fill.
The scheduled strategy rules are enforced on scheduled allocations; standalone
proposal routes enforce their own risk policy. Skill reasoning is not an
additional server authorization control.

## Failure handling

- 401/403: stop; the operator must fix admin credentials/scopes.
- 404: recheck the requested analysis or proposal ID and ownership.
- 409: do not change the key to evade conflict. Read an existing known proposal
  or retry the exact uncertain request once, then stop if unresolved.
- 422: explain the policy failure; do not loosen limits automatically.
- Connection/502/503: report unavailable data. Preserve the payload/key if a
  submission outcome is unknown; never claim execution succeeded.
