#!/usr/bin/env node
// Read-only rollout checks. Prints status/counts, never credentials or account data.
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { execFileSync } from 'node:child_process';
const base = process.env.SERVICE_URL;
if (!base || new URL(base).protocol !== 'https:') throw new Error('Set an HTTPS SERVICE_URL');
const env = dotenv.parse(readFileSync(process.env.ENV_FILE || '.env'));
if (process.env.ADMIN_PASSWORD_SECRET) env.ADMIN_PASSWORD = execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', `--secret=${process.env.ADMIN_PASSWORD_SECRET}`], { encoding: 'utf8' });
const agent = JSON.parse(env.AGENT_CREDENTIALS_JSON || '[]').find(a => a.role === 'admin');
let failures = 0;
async function check(path, options = {}, expected = 200) {
  try {
    const response = await fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(30000), redirect: 'error' });
    const text = await response.text();
    if (response.status !== expected) failures++;
    console.log(`${path}: HTTP ${response.status}${response.status === expected ? '' : ` (expected ${expected})`}`);
    return { response, text };
  } catch { failures++; console.log(`${path}: connection failed`); return undefined; }
}
for (const path of ['/health', '/', '/analysis?symbol=SPY', '/api/v1/instruments', '/api/v1/analyses/latest', '/api/v1/alerts', '/api/v1/paper/calendar?month=2026-11']) await check(path);
await check('/admin', {}, 401);
await check('/calendar', {}, 401);
await check('/api/v1/trading/calendar?month='+new Date().toISOString().slice(0,7), {}, 401);
await check('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 401);
if (agent) {
  const headers = { Authorization: `Bearer ${agent.token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
  async function mcp(method, params = {}) {
    const result = await check('/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (!result) return;
    const data = JSON.parse(result.text);
    if (data.error || data.result?.isError) { failures++; console.log(`  ${method}: protocol/tool error`); if (data.result?.isError) console.log(data.result.content?.[0]?.text); }
    else console.log(`  ${method}: OK${data.result?.tools ? ` (${data.result.tools.length} tools)` : ''}`);
  }
  await mcp('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'cloud-smoke', version: '1' } });
  await mcp('tools/list');
  for (const name of ['get_trading_context', 'get_paper_portfolio', 'get_portfolio', 'get_recent_orders']) await mcp('tools/call', { name, arguments: {} });
}
if (env.ADMIN_PASSWORD) {
  const headers = { Authorization: `Basic ${Buffer.from(`${env.ADMIN_USERNAME || 'admin'}:${env.ADMIN_PASSWORD}`).toString('base64')}` };
  await check('/admin', { headers });
  await check('/calendar', { headers });
  await check('/api/v1/trading/calendar?month='+new Date().toISOString().slice(0,7), { headers });
  await check('/api/v1/auth/token-status', { headers });
  await check('/api/v1/instruments/SPY/pricehistory?from=2026-11-09&to=2026-11-13', { headers });
}
console.log(`Read-only smoke checks: ${failures} failure(s)`);
process.exitCode = failures ? 1 : 0;
