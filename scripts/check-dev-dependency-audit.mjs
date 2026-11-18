import { spawnSync } from 'node:child_process';

const audit = spawnSync('pnpm', ['audit', '--dev', '--audit-level', 'moderate', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
if (audit.error) throw audit.error;
if (audit.status !== 0 && audit.status !== 1) {
  throw new Error(`Development dependency audit did not complete (${audit.signal ?? audit.status})`);
}

const report = JSON.parse(audit.stdout);
if (!report.advisories || typeof report.advisories !== 'object' || Array.isArray(report.advisories)) {
  throw new Error('Development dependency audit returned no advisory report');
}
const advisories = Object.values(report.advisories);
if ((advisories.length > 0) !== (audit.status === 1)) {
  throw new Error('Development dependency audit exit status disagrees with its advisory report');
}

// Remove this exception when fixed releases replace both locally patched versions.
const patchedVersions = new Set(['2.3.2', '4.0.5']);
for (const advisory of advisories) {
  const versions = advisory.findings?.map(finding => finding.version);
  const label = `${advisory.github_advisory_id}: ${advisory.module_name} (${advisory.severity})`;
  if (advisory.github_advisory_id === 'GHSA-fc5q-39xc-vjpf' && advisory.module_name === 'picomatch'
    && versions?.length > 0 && versions.every(version => patchedVersions.has(version))) {
    console.log(`${label} is temporarily covered by local patches for ${versions.join(', ')}.`);
  } else {
    console.error(`${label} requires remediation.`);
    process.exitCode = 1;
  }
}
if (advisories.length === 0) console.log('No development dependency advisories at moderate severity or higher.');
