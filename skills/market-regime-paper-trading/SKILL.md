---
name: market-regime-paper-trading
description: Review market-regime analyses and simulated portfolio performance, apply the project's versioned paper trading rules, and test authorized proposals through the market-regime-monitor MCP tools. Use for this application's trading-agent workflow, not live broker trading.
---

Use the `market-regime-monitor` MCP connection. Read
[references/workflows.md](references/workflows.md) for tool inputs and the
separation between scheduled allocation and standalone proposals.

Read `get_paper_portfolio` for paper policy, current versioned rules, holdings,
recent decisions and reports. Read `get_trading_context` for source analyses.
Use the account ID and experiment named by the user; if several are returned
and the intended account is unclear, inspect them read-only and ask which to use
before proposing a mutation. Portfolio outputs are private: summarize only what
the task needs and never put tokens or raw account identifiers in artifacts.

Apply the returned rules and server limits. Increase a paper allocation only
when the target instrument's regime, signed score and heuristic confidence meet
the configured entry criteria. Honor bearish exits and avoid new allocation in
other regimes. Do not treat confidence as a probability, invert a VIX signal
into an equity instruction, or introduce an unconfigured strategy mapping.
Missing, stale or conflicting inputs justify HOLD, not invented evidence.

Scheduled planning consumes only that invocation's successful previous-session
analyses. Interactive context can include multiple sessions and insufficient
results: identify the source date explicitly and do not claim it meets the
scheduler's freshness gate without checking. Never modify timestamps or loosen
policy to get a request accepted. Server validation remains authoritative.

For read-only review, report source dates, applicable rule version, proposed
HOLD/rebalance reasoning, exposure and limits, and data gaps. Do not submit a
proposal merely because this skill was discovered. A user instruction to test
or submit a simulation authorizes that simulated action within its stated
scope; do not expand it into live execution or credential/configuration edits.

For an authorized standalone proposal, use `propose_trade` then
`get_trade_proposal`. Save the idempotency key and exact normalized payload;
retry an uncertain result once with the same payload and key. If still uncertain,
stop submission attempts and report the unresolved status. Never generate a new
key to work around a timeout, rejection or budget. An intentional new decision
needs its own key. Stop on 401/403 and report the access issue.

MCP proposals are BUY/LIMIT/DAY simulations and do not update the scheduled
paper ledger. There is no MCP tool for selling, submitting allocations to the
scheduled planner, enabling jobs, or placing broker orders. Describe unsupported
actions honestly instead of using another interface to bypass the boundary.

When reviewing performance, distinguish simulated fills from actual orders and
since-inception returns from daily or annualized returns. Include available fees,
slippage assumptions, benchmark period and omitted dividends/corporate actions.
A profitable short test is not evidence of dependable income.
