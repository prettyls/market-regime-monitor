#!/usr/bin/env node
// Upload only selected application credentials; values never enter command arguments/logs.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
const project = process.env.PROJECT_ID;
if (!project) throw new Error('Set PROJECT_ID');
const region = process.env.REGION || 'us-east4';
const service = process.env.SERVICE_NAME || 'market-regime-monitor';
const prefix = process.env.CREDENTIAL_SECRET_PREFIX || 'market-regime';
const env = dotenv.parse(readFileSync(process.env.ENV_FILE || '.env'));
function run(args, input) {
  const result = spawnSync('gcloud', [...args, `--project=${project}`, '--quiet'], { encoding: 'utf8', ...(input === undefined ? {} : { input }) });
  if (result.status !== 0) throw new Error(`gcloud ${args.slice(0, 3).join(' ')} failed; inspect cloud permissions`);
  return result.stdout.trim();
}
const config = JSON.parse(run(['run', 'services', 'describe', service, `--region=${region}`, '--format=json']));
const spec = config.spec.template.spec;
const runtime = spec.serviceAccountName;
const deployer = `market-regime-deployer@${project}.iam.gserviceaccount.com`;
const uploads = new Map();
for (const connection of ['MARKET', 'TRADE']) {
  for (const key of ['CLIENT_ID', 'CLIENT_SECRET', 'ACCESS_TOKEN', 'REFRESH_TOKEN']) {
    const name = `SCHWAB_${connection}_${key}`;
    const value = env[name];
    if (!value && connection === 'MARKET') throw new Error(`Missing ${name}`);
    if (value) uploads.set(`${prefix}-${connection.toLowerCase()}-${key.toLowerCase()}`, value);
  }
}
const agents = JSON.parse(env.AGENT_CREDENTIALS_JSON || '[]');
if (!agents.some(a => a.role === 'admin' && a.token?.length >= 32)) throw new Error('Configure an admin agent credential first');
uploads.set(`${prefix}-agents`, JSON.stringify(agents));
// Preserve the running database connection instead of copying a possibly local .env URL.
const database = spec.containers[0].env.find(e => e.name === 'DATABASE_URL');
const databaseValue = database?.value || (database?.valueFrom && run(['secrets', 'versions', 'access', database.valueFrom.secretKeyRef.key, `--secret=${database.valueFrom.secretKeyRef.name}`]));
if (!databaseValue) throw new Error('Running service has no database URL');
uploads.set(`${prefix}-runtime-database`, databaseValue);
for (const [name, value] of uploads) {
  const exists = spawnSync('gcloud', ['secrets', 'describe', name, `--project=${project}`], { stdio: 'ignore' }).status === 0;
  if (!exists) run(['secrets', 'create', name, '--replication-policy=automatic']);
  run(['secrets', 'versions', 'add', name, '--data-file=-'], value);
  for (const identity of [runtime, deployer]) {
    run(['secrets', 'add-iam-policy-binding', name, `--member=serviceAccount:${identity}`, '--role=roles/secretmanager.secretAccessor']);
  }
  console.log(`Stored and authorized secret ${name}`);
}
console.log(`Trade refresh credential: ${env.SCHWAB_TRADE_REFRESH_TOKEN ? 'ready' : 'missing; scheduler must remain paused'}`);
