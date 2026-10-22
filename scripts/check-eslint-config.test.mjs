import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import { fileNamingRule } from '../eslint.config.mjs';

test('Obsidian DOM creation helpers are enforced for source files', async () => {
  const eslint = new ESLint();
  const config = await eslint.calculateConfigForFile('src/utils/fileLink.ts');

  assert.deepEqual(config.rules['obsidianmd/prefer-create-el'], [2]);
});

test('TypeScript promise rejections require Error reasons', async () => {
  const eslint = new ESLint();
  const config = await eslint.calculateConfigForFile(
    'src/features/chat/execution/ChatExecutionCoordinator.ts',
  );

  assert.deepEqual(config.rules['prefer-promise-reject-errors'], [
    2,
    { allowEmptyReject: false },
  ]);
});

test('TSX components use the same typed safety checks as TypeScript source', async () => {
  const eslint = new ESLint();
  const config = await eslint.calculateConfigForFile('src/features/chat/ui/ModelSelectorView.tsx');

  assert.equal(config.rules['@typescript-eslint/no-misused-promises']?.[0], 2);
  assert.equal(config.rules['@typescript-eslint/unbound-method']?.[0], 2);
  assert.equal(config.rules['@typescript-eslint/no-unsafe-member-access']?.[0], 2);
});

test('dynamic editor decorations and Cursor catalogs have no unsafe member access', async () => {
  const eslint = new ESLint({ overrideConfig: {
    rules: { '@typescript-eslint/no-unsafe-member-access': 'error' },
  } });
  const results = await eslint.lintFiles([
    'src/features/chat/ui/ComposerEditor.ts',
    'src/providers/cursor/models.ts',
  ]);
  const messages = results.flatMap(result => result.messages)
    .filter(message => message.ruleId === '@typescript-eslint/no-unsafe-member-access');
  assert.deepEqual(messages, []);
});

test('OMP role resolution uses timers without disabling Obsidian lint rules', async () => {
  const eslint = new ESLint({ overrideConfig: { linterOptions: { noInlineConfig: true } } });
  const results = await eslint.lintFiles(['src/providers/omp/metadata/OmpModelDiscoveryService.ts']);
  assert.deepEqual(results.flatMap(result => result.messages), []);
});

test('source compatibility boundaries avoid deprecated API references', () => {
  // CI single-run parsing treats repeated files as autofix passes and drops
  // imported types. Keep this second source scan in a fresh parser process.
  const eslintCli = fileURLToPath(new URL('../node_modules/eslint/bin/eslint.js', import.meta.url));
  const result = spawnSync(process.execPath, [
    eslintCli,
    'src/app/obsidian/ObsidianWorkspaceToolBridgeServer.ts',
    'src/features/chat/rendering/MessageRenderer.ts',
    'src/features/chat/rendering/WelcomeRenderer.ts',
    'src/features/chat/tabs/Tab.ts',
    'src/features/chat/tabs/TabBar.ts',
    'src/features/chat/ui/ComposerEditor.ts',
    'src/features/settings/ClaudianSettings.ts',
    'src/shared/components/SelectableDropdown.ts',
    'src/shared/components/SelectableDropdownView.tsx',
    'src/shared/mention/MentionDropdownController.ts',
    'src/shared/modals/ConfirmModal.ts',
    'src/shared/settings/SettingsTabBar.tsx',
    '--rule', '@typescript-eslint/no-deprecated:error',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}${result.stderr}`);
});

// ESLint hands the rule an absolute path using the host platform's separator, so the
// basename has to be taken from either separator. Windows paths are used here on every
// platform on purpose: they are what regressed, and CI only runs Linux.
function reportsFor(physicalFilename) {
  const reported = [];
  const visitor = fileNamingRule.create({
    physicalFilename,
    report: descriptor => reported.push(descriptor),
  });
  visitor.Program({ body: [] });

  return reported;
}

test('file naming reads the basename from either path separator', () => {
  assert.deepEqual(reportsFor('/repo/src/utils/fileLink.ts'), []);
  assert.deepEqual(reportsFor('D:\\repo\\src\\utils\\fileLink.ts'), []);
});

test('file naming still rejects an invalid basename behind a Windows path', () => {
  const reported = reportsFor('D:\\repo\\src\\utils\\some_snake_case.ts');

  assert.equal(reported.length, 1);
  assert.equal(reported[0].messageId, 'invalidCase');
  assert.equal(reported[0].data.name, 'some_snake_case.ts');
});
