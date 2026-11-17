---
name: market-regime-real-trading
description: Review a real Schwab account's balances, positions, exposure and recent broker orders using market-regime-monitor. Use for real-account reconciliation and trade preparation.
---

Use the configured `market-regime-monitor` MCP connection. Read actual positions
and balances with `get_portfolio({})` and actual broker order records with
`get_recent_orders({})` as needed. The order history covers the trailing seven
days. For market-regime evidence, use `get_trading_context({})` when available
and identify the analysis symbol and session date.

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
indices only as context or benchmarks. Verify the exact instrument and its
broker eligibility. Check the freshness of market evidence and the availability
of a current quote before assessing a price or timing. Identify assumptions and
missing inputs that prevent a decision. Use the live account's verified
restrictions and the user's stated risk limits.

The current connection supports read-only broker access. If asked to place,
modify or cancel an order, explain the capability limit and provide only the
requested preparation that the available evidence supports. The proposal tools
record simulations. Keep them out of the real-account workflow and base any
claim about an actual order or fill on its broker record.
