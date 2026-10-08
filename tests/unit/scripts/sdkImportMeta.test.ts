import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import * as sdkImportMetaHelpers from '../../../scripts/sdkImportMeta.js';

const { SDK_IMPORT_META_FILTER, patchSdkImportMetaUrl } = sdkImportMetaHelpers;

const claudeSdkDir = path.join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk');

describe('SDK import.meta build patch', () => {
  it.each([
    'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
    'node_modules/@anthropic-ai/claude-agent-sdk/core.mjs',
    'node_modules/@anthropic-ai/claude-agent-sdk/core-3mr1yqt9.mjs',
    'node_modules/@openai/codex-sdk/dist/index.js',
  ])('targets %s', (file) => {
    expect(SDK_IMPORT_META_FILTER.test(`/repo/${file}`)).toBe(true);
  });

  it('does not target unrelated SDK files', () => {
    expect(SDK_IMPORT_META_FILTER.test('/repo/node_modules/@anthropic-ai/claude-agent-sdk/bridge.mjs'))
      .toBe(false);
  });

  it('rewrites aliased createRequire and fileURLToPath calls', () => {
    const input = [
      'import{createRequire as Ll}from"node:module";',
      'import{fileURLToPath as rc}from"url";',
      'var Tt=Ll(import.meta.url);let te=rc(import.meta.url);',
    ].join('');

    const patched = patchSdkImportMetaUrl(input);

    expect(patched).toContain('Ll(__filename)');
    expect(patched).toContain('te=__filename');
    expect(patched).not.toContain('import.meta.url');
  });

  it('rewrites minified SDK aliases that start with a dollar sign', () => {
    const input = 'import{createRequire as $Z}from"node:module";var HZ=$Z(import.meta.url);';

    const patched = patchSdkImportMetaUrl(input);

    expect(patched).toContain('$Z(__filename)');
    expect(patched).not.toContain('import.meta.url');
  });

  it('removes every import.meta.url use from bundled Claude SDK entry chunks', () => {
    const entries = readdirSync(claudeSdkDir)
      .filter(file => SDK_IMPORT_META_FILTER.test(path.join(claudeSdkDir, file)));

    expect(entries).toEqual(expect.arrayContaining(['core.mjs', 'sdk.mjs']));
    for (const file of entries) {
      const patched = patchSdkImportMetaUrl(readFileSync(path.join(claudeSdkDir, file), 'utf8'));
      expect({ file, hasImportMetaUrl: patched.includes('import.meta.url') })
        .toEqual({ file, hasImportMetaUrl: false });
    }
  });
});
