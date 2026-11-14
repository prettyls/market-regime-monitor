# MCP agent access

The MCP adapter uses the official TypeScript SDK and stdio transport. Any agent
host supporting local stdio MCP servers can launch it. It calls the existing
REST API; authorization, instrument restrictions, snapshots, budgets and
idempotency remain enforced by that API. Execution is simulation only.

## Configure

Start the API separately and build the adapter:

```bash
npm run build
npm run dev
```

Create an agent credential on the API server using `AGENT_CREDENTIALS_JSON` as
described in [agent trading](agent-trading.md). Give it `analysis:read`,
`portfolio:read`, and `trades:propose` as needed. Restart the API after changing
credentials. The MCP token must match that agent's token, not a Schwab token.

Add this entry to your MCP host's server configuration:

```json
{
  "mcpServers": {
    "market-regime-monitor": {
      "command": "node",
      "args": ["/Users/ranliu/git/market-regime-monitor/dist/src/mcp.js"],
      "env": {
        "MCP_API_URL": "http://localhost:3000",
        "MCP_AGENT_TOKEN": "YOUR_SCOPED_AGENT_TOKEN"
      }
    }
  }
}
```

Use your checkout's absolute path and a Node.js 22+ executable available to the
host (an absolute Node path may be needed for desktop apps). The host owns
starting and stopping the adapter. The API must already be running. Configuration
key names vary between hosts; the executable, arguments and environment above
are the portable parts. Use a host secret store for the token when available.

The adapter does not load `.env` and does not need Schwab credentials or database
access. It writes only MCP messages to stdout. `npm run start:mcp` and
`npm run dev:mcp` are convenience commands for manual use; configure hosts to
launch Node directly to avoid npm banners on the protocol stream.

Only HTTPS API origins and loopback HTTP origins are accepted. Redirects are
blocked so authorization cannot be forwarded to a different location. For an
IAM-protected Cloud Run API, point this adapter at the authenticated localhost
proxy documented in the README; it does not mint Google identity tokens.

## Tools

| Tool | Purpose | Required API scope |
| --- | --- | --- |
| `get_trading_context` | Saved analyses, policy and simulation mode | `analysis:read` |
| `get_portfolio` | Actual Schwab accounts, positions and balances | `portfolio:read` |
| `get_paper_portfolio` | Paper ledger, saved decisions and reports | `portfolio:read` |
| `get_recent_orders` | Actual broker orders, trailing seven days | `portfolio:read` |
| `propose_trade` | Save a simulated BUY LIMIT DAY proposal | `trades:propose` |
| `get_trade_proposal` | Read this agent's saved proposal by ID | `trades:propose` |

All six tools are discoverable. The API rejects tools requiring scopes that
the configured credential lacks. Portfolio outputs contain private account data;
connect only agent hosts you intend to receive it.

Example agent instruction:

> Use get_trading_context to inspect saved analyses and policy. Read portfolio
> and recent orders if needed. Propose a simulation for a registered EQUITY/ETF
> within policy only when justified by the analysis. Use a unique idempotency key
> per decision, and retry an uncertain request using the identical payload and
> key. Report SIMULATED as a hypothetical result, never a broker fill.

`propose_trade` uses the same fields as the REST endpoint:

```json
{
  "analysisId": "ID_FROM_CONTEXT",
  "strategyId": "regime-allocation-v1",
  "symbol": "SPY",
  "side": "BUY",
  "quantity": 1,
  "orderType": "LIMIT",
  "limitPrice": "100.00",
  "timeInForce": "DAY",
  "reason": "Illustrative simulation",
  "idempotencyKey": "agent-analysis123-spy-001"
}
```

The price is illustrative. No live quote or real fill validation occurs.
Tool HTTP failures return MCP `isError: true` with safe status guidance. Network
timeouts can leave proposal outcomes uncertain; never generate a fresh key just
to retry. Inspect API server logs for detailed diagnostics.

## Verify

Restart/reconnect your host and check that it discovers all six tools. Ask for
`get_trading_context` first, then a permitted proposal and `get_trade_proposal`.
Use the end-to-end REST setup to ensure the analysis, target instrument and
policy exist first. `npm test` exercises tool discovery, calls and validation
through an MCP client/server transport, as well as API policy tests.

This is a local stdio bridge to a local or remote API. It does not expose a
remote Streamable HTTP `/mcp` endpoint, and it adds no live trading capabilities.

### Inspector environment troubleshooting

Inspector may not pass arbitrary shell variables into its child process. Pass
adapter variables explicitly (or add them in Inspector's Environment Variables
section):

```bash
export MCP_AGENT_TOKEN='YOUR_SCOPED_AGENT_TOKEN'
npx @modelcontextprotocol/inspector \
  -e MCP_API_URL=http://localhost:3000 \
  -e MCP_AGENT_TOKEN="$MCP_AGENT_TOKEN" \
  node /Users/ranliu/git/market-regime-monitor/dist/src/mcp.js
```

The adapter does not load `.env`. A token saved there, or exported only to the
Inspector process, is not enough unless forwarded to the adapter. Use the agent
credential configured on the API, not a Schwab token. After changing adapter
source, run `npm run build` and reconnect Inspector.

Trading and agent endpoints require an explicitly configured `role: "admin"`
in each authorized `AGENT_CREDENTIALS_JSON` entry, in addition to the required
scope. Missing roles default to `user` and return 403. Anonymous/invalid tokens
return 401. These bearer credentials delegate admin access only to their listed
scopes; the browser's Basic admin login does not replace them. MCP uses the same
server-side role checks. The stdio adapter exposes no listening network port.
After updating roles, restart the API to apply configuration.
