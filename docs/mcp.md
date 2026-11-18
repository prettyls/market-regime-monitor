# MCP agent access

The MCP adapter uses the official TypeScript SDK and stdio transport. Any agent
host supporting local stdio MCP servers can launch it. It calls the existing
REST API; authorization, instrument restrictions, snapshots, budgets and
idempotency remain enforced by that API. Live submission requires separate server configuration and scope.

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
| `get_trading_skill` | Deployed skill Markdown, references, and content version for `paper` or `live` | `analysis:read` |
| `get_trading_context` | Saved analyses, simulation policy and eligible symbols | `analysis:read` |
| `get_schwab_bars` | Schwab OHLCV candles for registered Schwab instruments | `analysis:read` |
| `get_portfolio` | Actual Schwab accounts, positions and balances | `portfolio:read` |
| `get_paper_portfolio` | Paper ledger, saved decisions and reports | `portfolio:read` |
| `get_recent_orders` | Actual broker orders, trailing seven days | `portfolio:read` |
| `get_live_trading_permission` | Live-order switch, configured limits and eligible symbols when enabled | `trades:execute` |
| `place_live_order` | Submit a live Schwab BUY or SELL LIMIT DAY order | `trades:execute` |
| `propose_trade` | Save a simulated BUY LIMIT DAY proposal | `trades:propose` |
| `get_trade_proposal` | Read this agent's saved proposal by ID | `trades:propose` |

Agents can call `get_trading_skill` with `{"workflow":"paper"}` or
`{"workflow":"live"}` over either MCP transport. The API serves the repository
skill and its bundled references in one response. The version is a SHA-256
fingerprint of the returned files and changes when their contents change.
The agent host needs to discover and call the tool. Trading permissions are
checked separately by the order endpoints.

Scheduled regime analysis uses daily candles. For an on-demand Schwab lookup,
call `get_schwab_bars` with inputs such as `{"symbol":"SPY","interval":"5m"}`.
Supported intervals are `1d`, `1m`, `5m`, `10m`, `15m`, `30m`, and `1h`. Intraday
candles cover regular trading hours. Hourly candles combine Schwab 30-minute
candles in windows aligned to 9:30 a.m. Eastern. The final window can be
shorter at the session close or at the end of the requested range. Optional
`from` and `to` values take ISO 8601 timestamps with offsets. With no bounds,
intraday requests use Schwab's
one-day period. Each bar includes `volumeChange` and `volumeChangePct` versus
the previous returned bar at the same interval. A missing comparison returns
`null`. A zero prior volume also yields a `null` percentage. Compare completed
bars of equal duration when interpreting changes in participation.

All tools are discoverable. The API rejects tools requiring scopes that
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

Restart/reconnect your host and check that it discovers all tools. Ask for
`get_trading_context` first, then a permitted proposal and `get_trade_proposal`.
Use the end-to-end REST setup to ensure the analysis, target instrument and
policy exist first. `npm test` exercises tool discovery, calls and validation
through an MCP client/server transport, as well as API policy tests.

This is a local stdio bridge to a local or remote API. The API also exposes a remote Streamable HTTP `/mcp` endpoint as described below. Both transports enforce the API server’s [live-order permission](agent-trading.md#enable-agent-live-orders).

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

## Direct cloud connection

Cloud Run also supports authenticated Streamable HTTP at:

```text
https://YOUR_CLOUD_RUN_SERVICE/mcp
```

Configure an HTTP MCP client with that URL and
`Authorization: Bearer YOUR_SCOPED_AGENT_TOKEN`. Each request requires a configured
admin-role agent token; every tool still passes through the REST scope checks.
The server is stateless and can run across Cloud Run replicas without session
stickiness. It accepts POST requests and returns JSON; standalone GET streams
and DELETE sessions return 405. Clients must advertise both `application/json`
and `text/event-stream` in `Accept`. Browser origins must match the service origin.
No OAuth discovery or interactive MCP login is provided; use a client supporting
an explicitly configured bearer header. See [cloud deployment](cloud-run.md#cloud-mcp-and-separate-trading-token-refresh)
for secret bindings and token-refresh setup.
