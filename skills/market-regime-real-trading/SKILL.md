---
name: market-regime-real-trading
description: Review a real Schwab account's balances, positions, exposure and recent broker orders using market-regime-monitor. Use for real-account reconciliation, trade preparation and authorized live BUY and SELL limit orders.
---

Use the configured `market-regime-monitor` MCP connection. Read actual positions
and balances with `get_portfolio({})` and actual broker order records with
`get_recent_orders({})` as needed. The order history covers the trailing seven
days. For market-regime evidence, use `get_trading_context` when available.
When the source symbol is known, pass it as `{"symbol":"VIX"}` to get its
latest saved analysis. Omit the filter when you need to discover analyses
across symbols. Identify the analysis symbol and session date.

Use `get_schwab_bars` for market candles at the requested interval. For
five-minute candles, pass `interval: "5m"`. If Schwab is unavailable or returns
no candles for the requested window, report the data gap and use Schwab as the
sole source for the request. When analyzing bars, report volume change alongside
price action for each requested interval. Compare completed bars of the same
interval and duration, and flag missing volume or partial bars separately.
For intraday participation across sessions, compare the same time of day
when those bars are available.

Use the account the user names. If several accounts match or the intended
account is unclear, ask which account to review before presenting
account-specific conclusions. Keep account details private and use masked
identifiers when identifying an account in a report. On 401 or 403, report the
access issue. Portfolio reads require a configured admin agent credential with
`portfolio:read`; context requires `analysis:read`. Have the operator resolve
access through their configured connection. Never read or request raw secrets.

Reconcile positions, balances and orders for the selected account. Distinguish
working, partially filled, filled, canceled and rejected orders using the
reported broker status and filled quantities. Account for working orders when
reviewing exposure and buying power. If the inputs cover different timestamps
or a fill is outside the available history, report the reconciliation gap.
Use applicable account restrictions from verified broker data or user-provided
account rules.

For trade preparation, consider equities and ETFs across tickers and use
indices only as context or benchmarks. Use the live permission response's
`allowedSymbols` to screen equities and ETFs before fetching symbol-specific
market evidence or analyzing them for a trade. Skip symbols outside that list.
Include any blocked holdings and fills in account reconciliation and applicable
plan totals. If live eligibility is unavailable or execution is disabled, report
the gap or restriction and continue account reconciliation. Verify the exact
instrument and its broker eligibility. Check the freshness of market evidence and the availability
of a current quote before assessing a price or timing. Identify assumptions and
missing inputs that prevent a decision. Use the live account's verified
restrictions and the user's stated risk limits.

Use a $500 baseline for live trading. The trading allowance is the greater of
$500 and $500 plus cumulative net realized P&L for the trading plan. Count
closed fills and their attributable fees. Recalculate from cumulative P&L so
losses still offset later gains after the floor is reached. Exclude unrealized
P&L and cash transfers.

Identify each order as a trading-plan order or a separate holding at entry.
Use a plan ledger that covers history beyond Schwab's seven-day window and
records matched fills, attributable fees, open cost basis, and unfilled buy
commitments. Leave historical attribution unresolved when the evidence is
incomplete. Report realized P&L from matched execution prices separately from
unrealized P&L at the broker mark. Label fill-based P&L as before fees when
attributable fees are unavailable.

For new buys, subtract the cost basis of open plan positions and the unfilled
amount of working buy orders from the allowance. Size within the remaining
allowance, verified broker buying power, and applicable order limits. If the
realized P&L history or committed capital cannot be reconciled, report the gap
and defer new buys. Report the allowance separately from available buying power.

Before sizing a new trade, record the thesis, the price or condition that
invalidates it, and the dollar loss budget within the user's risk limits. Size
against both available capital and estimated loss per share, including an
allowance for slippage. If the exit condition has no usable price estimate or
the risk budget is missing, identify the missing input before proposing a size.
Specify how the exit condition will be monitored and account for the possibility
that a DAY limit exit may go unfilled. After closing, record the exit reason,
compare actual P&L with planned risk, and review fill prices against order
limits. Use a series of comparable closed trades to assess signal changes.

Before live submission, call `get_live_trading_permission({})` and verify that
the server enables execution for this agent, the configured account is the
intended account, and the order fits the returned limits. Submit only within
the user's explicit live-trading authorization. Use `place_live_order` for
a BUY or SELL LIMIT DAY order and use a unique idempotency key per decision.
Before selling, verify the available long position and account for shares
committed to working sell orders.
Use the same payload and key to recover a receipt after a transport failure.
Reconcile PENDING or UNKNOWN against Schwab order records before considering
another order. Treat SUBMITTED as broker acceptance and verify fills with
broker records. Use `get_recent_orders` to check execution status.

Report the capability limit when asked to short sell, cancel, or modify an order.
Keep simulated proposals out of the real-account workflow.
