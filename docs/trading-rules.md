# Agent trading rules

The versioned rule source is `src/paper/trading-rules.json`. These defaults define
an experimental paper strategy; the thresholds have not been validated as
predictive probabilities or a profitable investment strategy.

| Condition | Scheduled allocation rule |
| --- | --- |
| TREND_UP or BREAKOUT_UP, score >= 50 and confidence >= 60 | May increase allocation within account policy; trading is optional |
| TREND_DOWN or BREAKOUT_DOWN with an existing holding | Must REBALANCE with that symbol's target set to zero |
| Other regimes, weak score, or weak confidence | No allocation increase; HOLD or reduce exposure |
| Missing/stale data, failed collection, or insufficient analysis | No scheduled plan/execution |

Score is directional, from −100 to +100. Confidence is heuristic strength from
0 to 100, not a success probability. Rules apply to the traded instrument's own
analysis. This strategy does not infer equity direction from VIX or allow an
unconfigured cross-instrument mapping.

The scheduled agent receives these rules in its input. The server validates the
decision against them before saving READY and again before execution. Allocation
increases in unqualified regimes are compared with current weight from the
reference closing price at planning and fresh midpoint at execution. Consequently
price movement can make a planned allocation invalid; it is rejected rather
than silently rewritten. Bearish zero targets are implemented subject to daily
turnover and order limits, so an exit may take more than one session.

The paper account policy remains separate: configured EQUITY/ETF symbols,
long-only holdings, position weight, cash reserve, order and daily turnover caps,
spread/freshness limits, fees and slippage. The rules cannot override these.
Changing a rule requires a new version and a rebuild/redeploy across all jobs.
Rules are included in saved run snapshots; changes between planning and execution
block execution. Existing plans created before rule snapshots were introduced
must not be treated as compatible; wait for the next session or start a new
experiment/account.

To customize research behavior, edit `src/paper/trading-rules.json` and update
`version`. Edit `PAPER_TRADING_JSON` for account limits. Do not automatically
loosen either in response to a losing day or rejected request. Compare paper
results over multiple sessions against the benchmark, with costs and omitted
corporate actions noted.

## Codex skill

The reusable source is `skills/market-regime-paper-trading/SKILL.md`. Install its
folder under your Codex skills directory, then start a fresh session. Invoke:

> $market-regime-paper-trading Review today's paper decisions and reports. Check
> them against the saved rules and explain any skipped trades. Read-only.

Or, after choosing an illustrative price:

> $market-regime-paper-trading Test one simulated proposal within policy using
> the selected analysis and my specified limit. Read back its saved status.

The skill uses MCP and does not contain credentials. Cloud planning does not
load Codex skill files: it receives the structured rule source directly. MCP's
standalone BUY simulations are independent of the scheduled portfolio and do
not update cash or positions. See [MCP setup](mcp.md) and
[scheduled paper workflow](paper-trading.md).

For automatic diagnosis and proposed revisions after losses or missed targets,
see [performance-driven rule/skill reviews](rule-reviews.md). Candidates do not
change active rules or the installed skill without validation and activation.
