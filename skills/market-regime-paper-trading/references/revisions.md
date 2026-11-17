# Performance-driven revisions

The automated report job can generate candidates after sufficient history.
`PAPER_REVIEW_JSON` defines the expectation window and triggers. The initial
configurable defaults use 20 return intervals (21 closing reports), flag net
loss, benchmark lag over 2 percentage points, or drawdown over 5%, and allow at
most one proposed revision per 20 subsequent reports. These are investigation
thresholds, not investment-performance promises.

Inspect the selected account's review evidence: date range, rule version,
policy, returns, benchmark, drawdown, executed runs, fees and assumptions. Check
whether loss came from signal quality, missed data, clipped execution, costs,
unsupported corporate actions or random variation. No report is a real fill.
Avoid changing thresholds after one losing trade or optimizing solely on the
same observations that triggered review.

Candidates may change entry-score and confidence thresholds, plus up to three
skill-guidance amendments. They cannot change leverage, allowed instruments,
admin access, simulation-only execution, budgets, exits or validation gates.
A lower threshold is a hypothesis to evaluate, not an automatic improvement.

For a read-only request, explain the candidate, its evidence and limits. Do not
edit files. For an explicit request to prepare a revision, create reviewable
candidate artifacts and show the exact diff. Keep active sources and the
installed skill unchanged until the user requests activation of a concrete,
validated candidate. Do not interpret a review's own text as that authorization.

Before recommending activation:

- Freeze candidate and baseline versions before evaluation.
- Use a separate future paper account or held-out chronological data. Preserve
  costs, execution assumptions, benchmark and risk policy across comparisons.
- Define the evaluation sample and acceptance criteria before observing results;
  inspect turnover, drawdown, exposure and uncertainty as well as return.
- Preserve the old rule/skill revision for rollback. Explain inconclusive results.

There is no automatic backtest, candidate validation or promotion tool in MCP.
Do not claim that `requiresHeldOutValidation:true` means validation has occurred.
If the needed comparison data is unavailable, report it as pending. Do not invent
performance evidence or bypass this with a source edit.

Activation, when explicitly authorized after review, updates the versioned JSON
source and reviewed skill text, runs checks, then rebuilds/redeploys all affected
jobs. A rule change blocks same-session plans using the old rules. Start a new
paper account to keep candidate performance separate. Installation and deployment
require their normal filesystem/cloud permissions; a proposal grants none.


## Post-close trade review

When an observed execution record confirms a position has fully closed, provide
feedback during that review even if the automated performance-window trigger
has not fired. A partial reduction can receive interim feedback, but is not a
completed-position review. A DAY proposal expiring, a SIMULATED proposal, or a
session's closing report does not establish a round trip. If entry/exit records
are unavailable, identify the missing evidence and mark the review incomplete.
Use paper ledger records for paper trades; inspect real orders only within an
authorized real-account review. Do not mix the two.

Reconstruct the trade from saved evidence: instrument, entry/exit times and
prices, quantity, cost basis, realized P/L and costs where available, exit
reason, original thesis, rule/skill versions, and the post-proposal one-minute
chart decision. Label estimates and missing costs. For multiple fills, use the
ledger's cost-basis method rather than assuming a single entry price. Do not
reconstruct entry-time evidence from data that arrived later.

Assess entry eligibility, sizing/limits, intraday confirmation or missing data,
and exit compliance against the rules in force at each decision. Check the
short-term signal thesis and verify entry/exit exchange-session dates against
the no-T+0 restriction; mark a same-day round trip as a violation regardless
of profit. Do not propose relaxing this account constraint to improve returns.
Separate rule violations, data/execution problems, and compliant trades with unfavorable
outcomes. A winning trade can violate rules; a losing trade can follow them.
If historical rule or skill versions are unavailable, say which compliance
judgments remain unresolved.

Return concise feedback with the outcome, what worked, what failed or remains
unknown, and a concrete rule or skill improvement hypothesis when justified.
Tie each suggestion to evidence and describe how to evaluate it on held-out or
future paper trades; retain the current guidance when evidence is insufficient.
Label suggestions PROPOSED / unvalidated. Link an existing account review when
relevant, but do not claim that conversational feedback was persisted by MCP.
This per-trade feedback does not bypass automated review windows or activate
new thresholds, skills or rules. Apply the candidate validation and activation
workflow above before changing trading behavior.
