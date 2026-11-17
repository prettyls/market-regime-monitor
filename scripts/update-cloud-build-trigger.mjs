#!/usr/bin/env node
// Preserve repositoryEventConfig when updating an existing second-generation trigger.
// Some gcloud versions add a conflicting legacy github configuration on update.
import { execFileSync } from 'node:child_process';
const [project, region, name, repository, serviceAccount, encoded] = process.argv.slice(2);
if (!project || !region || !name || !repository || !serviceAccount || !encoded?.startsWith('^~^')) throw new Error('Missing trigger update arguments');
const substitutions = Object.fromEntries(encoded.slice(3).split('~').map(entry => {
  const separator = entry.indexOf('=');
  if (separator < 1) throw new Error('Invalid substitution');
  return [entry.slice(0, separator), entry.slice(separator + 1)];
}));
const trigger = JSON.parse(execFileSync('gcloud', ['builds', 'triggers', 'describe', name, `--region=${region}`, `--project=${project}`, '--format=json'], { encoding: 'utf8' }));
trigger.filename = 'cloudbuild.yaml';
trigger.serviceAccount = serviceAccount;
trigger.repositoryEventConfig = { repository, repositoryType: 'GITHUB', push: { branch: '^main$' } };
trigger.substitutions = { ...trigger.substitutions, ...substitutions };
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const response = await fetch(`https://cloudbuild.googleapis.com/v1/projects/${project}/locations/${region}/triggers/${trigger.id}`, {
  method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(trigger), signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error(`Cloud Build trigger update failed (HTTP ${response.status})`);
console.log(`Updated trigger ${name}`);
