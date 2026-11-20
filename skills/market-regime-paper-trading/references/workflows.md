# Tool workflows

All API-backed tools require a configured agent bearer credential with explicit
`role: "admin"` and the required scopes. A browser's Basic admin login is a
separate mechanism. Never read `.env` to recover secrets as part of a trading
review. Ask the operator to configure authentication when it is missing.

## Active trading session

The requested operating window is Monday–Friday, 09:30 inclusive to 16:00
exclusive in `America/New_York`. Use that IANA timezone so daylight-saving
changes do not shift the local window. Check the target exchange's session
calendar for holidays, early closes and session status through an available
authorized source; stop trading decisions at an earlier official close. If
session status cannot be verified, report the gap and defer new trading action.
Read-only preparation and post-close feedback may occur outside the window.

A persistent agent worker or scheduler must own this lifecycle. When invoked
without one, disclose that continuous coverage is unavailable; do not claim the
agent will wake itself, remain alive after the turn ends, or has enabled a job.
An active session authorizes monitoring within the selected paper account and
existing trading scope; it does not add broker execution or unsupported tools.

At session start (or a restart during the window), reload the account, policy,
rule version, saved decisions and unresolved proposals. Reconcile completed
work before taking new action. Reconcile entry fills, exchange-local entry
sessions and quantities eligible to close under the no-T+0 rule. Do not infer
eligibility from aggregate holdings or a saved proposal. During the session,
use a one-minute monitoring cadence when the runtime and data tools support it: inspect newly completed
one-minute bars, reevaluate pending setups and held positions against the active
rules, and perform the post-proposal chart check for new proposals. Being active
does not require making a trade. HOLD is a valid decision; do not generate a
new proposal on every tick or reprocess the same bar as new evidence.

Keep a resumable checkpoint in the runtime's authorized state store: session
and account reference, last processed bar, proposal IDs and idempotency keys,
exact uncertain payloads, decisions, and completed close reviews. Avoid raw
account identifiers in shared artifacts. Use one worker per account/session,
or equivalent deduplication, to prevent overlapping invocations from duplicating
decisions. After downtime, reconcile current state and skip missed ticks rather
than submitting historical decisions in a burst. Preserve existing retry and
authentication stopping conditions; report data outages and coverage gaps.

When a position close is confirmed, perform the linked post-close review during
the session rather than waiting for the end of the day. At the session boundary,
stop new trading decisions and provide a handoff listing open positions,
unresolved proposals, data gaps and feedback. Do not automatically liquidate
positions or claim DAY simulations were canceled or filled; closing positions
requires the applicable exit rules and a supported authorized execution path.
Leave unresolved outcomes available for reconciliation at the next session.

## Inspect the scheduled paper experiment

1. `get_paper_portfolio({})`: returns `policy`, `rules`, paper accounts, recent
   runs and closing reports. Select the requested account and session. Accounts
   contain cash and positions with total cost basis. Runs preserve the exact
   inputs, rule version, model decision and execution assumptions.
2. `get_trading_context({})`: returns standalone proposal policy and recent
   analyses. Its policy is `TRADING_POLICY_JSON`, whereas the paper portfolio's
   policy is `PAPER_TRADING_JSON`. They are separate. Find the intended symbol
   and date; confidence is a 0–100 heuristic strength measure.
   To retrieve only the latest saved analysis for a known source symbol, call
   `get_trading_context` with arguments such as `{"symbol":"VIX"}`.
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

## Post-proposal one-minute day-chart check

After `propose_trade` and `get_trade_proposal`, try to fetch the target symbol's
current-session day chart at **one-minute candle resolution** using an available,
authorized market-data tool. This is a follow-up snapshot, not a recurring
one-minute polling job by itself; repeated checks belong to the active-session
runtime described above. Inspect available tool capabilities first: the current
market-regime-monitor MCP has no intraday chart tool, and its REST price-history
route supports daily bars only. If another authorized source is available, use
it; otherwise record the missing capability and return HOLD / defer additional
action. Do not substitute daily candles or manufacture an intraday observation.

Record the source, symbol, session date/timezone, retrieval time, last completed
bar timestamp, and whether data is delayed or includes extended hours. Exclude
incomplete bars. Check that bars belong to the intended trading session, are
ordered, and have no material gaps. Apply configured freshness limits; if none
exist, disclose the observed age and do not claim freshness is policy-validated.
An unavailable, stale, delayed beyond policy, wrong-session or conflicting chart
supports HOLD pending usable evidence. Outside regular hours, identify the last
session explicitly; do not label it a current executable signal.

Compare the completed bars with the proposal thesis and active entry/exit rules:
price relative to the proposed limit, intraday direction, range and volume where
available. Use intraday evidence to assess timing and contradictions; do not
invent a new indicator threshold or let it override regime/risk gates. Candle
closes are historical trades, not executable bid/ask quotes.

Report the proposal ID/status, chart evidence (or the exact data gap), applicable
rule version, and a decision: retain the hypothetical setup, HOLD/defer further
action, or recommend an exit if an existing position meets its exit rules and
its verified quantity is eligible under the no-T+0 restriction. A reversal on
the entry day requires reporting a blocked exit and next-session reassessment,
not a same-day sale.
Explain what changed since the proposal and what would permit reconsideration.
A follow-up decision does not amend, cancel or execute the saved simulation.
Do not resubmit just because the chart changed. Any intentionally new proposal
must remain within the user's authorization and use a new decision key; preserve
the original proposal and its evidence. MCP cannot execute an exit or monitor
positions in the background.

## Failure handling

- 401/403: stop; the operator must fix admin credentials/scopes.
- 404: recheck the requested analysis or proposal ID and ownership.
- 409: do not change the key to evade conflict. Read an existing known proposal
  or retry the exact uncertain request once, then stop if unresolved.
- 422: explain the policy failure; do not loosen limits automatically.
- Connection/502/503: report unavailable data. Preserve the payload/key if a
  submission outcome is unknown; never claim execution succeeded.
