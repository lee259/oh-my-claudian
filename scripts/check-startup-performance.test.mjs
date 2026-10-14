import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function createFixture(t, mainSource) {
  const directory = await mkdtemp(path.join(tmpdir(), 'claudian-performance-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scriptDirectory = path.join(directory, 'scripts');
  await mkdir(scriptDirectory);
  await copyFile(new URL('./check-startup-performance.mjs', import.meta.url),
    path.join(scriptDirectory, 'check-startup-performance.mjs'));
  await writeFile(path.join(directory, 'main.js'), mainSource);
  await writeFile(path.join(directory, 'manifest.json'), '{}');
  await writeFile(path.join(directory, 'styles.css'), '');

  // Model a strict package installation: these host peers are not root dependencies.
  const markdown = path.join(directory, 'node_modules', '@lezer', 'markdown');
  await mkdir(markdown, { recursive: true });
  await writeFile(path.join(markdown, 'index.js'), 'module.exports = {};');
  for (const name of ['common', 'highlight']) {
    const peer = path.join(markdown, 'node_modules', '@lezer', name);
    await mkdir(peer, { recursive: true });
    await writeFile(path.join(peer, 'index.js'), `module.exports = { name: 'fixture-${name}' };`);
  }
  return directory;
}

function runCheck(directory) {
  return spawnSync(process.execPath, [path.join(directory, 'scripts', 'check-startup-performance.mjs')], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: '' },
  });
}

test('evaluates a plugin with host Lezer modules available only through the Markdown dependency', async t => {
  const directory = await createFixture(t, `
const assert = require('node:assert/strict');
assert.equal(require('@lezer/common').name, 'fixture-common');
assert.equal(require('@lezer/highlight').name, 'fixture-highlight');
`);
  const result = runCheck(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /median cold evaluation [\d.]+ ms/);
});

test('still fails when the plugin imports an unavailable non-host module', async t => {
  const directory = await createFixture(t, "require('missing-plugin-dependency');");
  const result = runCheck(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot find module 'missing-plugin-dependency'/);
});
