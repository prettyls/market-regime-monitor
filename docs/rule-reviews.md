# Performance feedback and candidate revisions

The closing report job can automatically diagnose missed expectations and
propose bounded changes to trading rules and agent skill guidance. It does not
overwrite active rules, execute model-generated code, edit installed skills,
change risk limits or activate candidates. No improvement is assumed until a
separate evaluation supports it.

## Configure expectations

```dotenv
PAPER_REVIEW_JSON='{"enabled":true,"windowSessions":20,"minimumReturn":0,"maximumBenchmarkLag":0.02,"maximumDrawdown":0.05,"cooldownSessions":20}'
```

Returns and thresholds are fractions: `0.02` means two percentage points and
`0.05` means 5%. A 20-session return window requires **21 closing observations**.
Triggers use strict inequalities: return below the target, benchmark lag above
the allowed lag, or drawdown above the threshold. The benchmark's window return
is calculated from its cumulative return at both endpoints, not subtracted.
Reports with missing benchmark data are not evaluated. Metrics are based on
paper closing equity, inclusive of modeled fees/slippage and their limitations.

Reviews require today's persisted report. They skip windows with no executed
runs or mixed active rule versions/account policies. The triggering evidence
and configuration are snapshotted. Each account/session/rule version has one
review record; repeated requests do not make another model call. A candidate
starts a cooldown measured in subsequent closing reports; losses inside that
cooldown are still recorded with status COOLDOWN. A failed or interrupted review
is not automatically regenerated, avoiding duplicate calls and conflicting edits.

Review statuses include NO_CHANGE (no trigger), REVIEWING, KEEP_RULES, PROPOSED,
COOLDOWN and FAILED. INSUFFICIENT_HISTORY, BENCHMARK_UNAVAILABLE,
NO_CURRENT_REPORT and MIXED_OR_MISSING_EXPERIMENT skip model generation.

The reviewer may propose only entry score/confidence thresholds and up to three
skill amendments with rationale. It must state a testable hypothesis and
validation plan. KEEP_RULES must retain both thresholds with no amendments.
Candidates receive a distinct version, `activation:NOT_ACTIVE` and
`requiresHeldOutValidation:true`. These labels are not proof of validation.

## Run and inspect

Apply migrations and configure the paper workflow first. Set OPENAI_API_KEY and
PAPER_AGENT_MODEL on the reporting job as well as the planning job. Then:

```bash
npm run paper:report
# Or review an already-created report without re-importing bars:
npm run paper:review
```

Reviewing can incur API charges when sufficient history triggers generation.
`get_paper_portfolio` in MCP, or the admin-only
`GET /api/v1/agent/portfolio/paper` endpoint with `portfolio:read`, returns the
most recent 20 review records. No public endpoint starts reviews or applies edits.
The review prompt receives paper reports/decisions, never broker credentials.

Cloud setup: create a Secret Manager secret holding the review JSON, set
`PAPER_REVIEW_SECRET` to its name, and rerun
`scripts/configure-paper-trading.sh`. This binds review config and the OpenAI
key/model to the existing paper-report job. Grant its runtime service account
access to these secrets. Review behavior defaults to disabled.

## Evaluate before activation

Freeze a candidate, preserve the baseline, then evaluate on separate future
paper sessions or held-out chronological data with comparable fees, slippage,
benchmark and risk policy. Define a sample requirement, drawdown/turnover bounds,
acceptance test and rollback criterion before inspecting results. The current
system records a suggested evaluation plan; it does not perform this comparative
validation automatically. Do not infer causation from one losing session.

Use the Codex skill to inspect candidates:

> $market-regime-paper-trading Review the latest proposed revisions and their
> evidence. Explain the hypothesis and validation still needed. Do not activate.

After an administrator authorizes a specific validated change, update
`src/paper/trading-rules.json` and its version, review the skill text diff, run
tests/skill validation and rebuild/redeploy. Never source or execute candidate
text as a script. Update the installed skill separately using the reviewed
source. Start a fresh paper account for the candidate experiment, and retain
the previous code/skill revision for rollback. Active skill security and
execution boundaries must not be rewritten by a performance review.
