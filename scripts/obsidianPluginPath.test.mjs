import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveObsidianPluginPath } from './obsidianPluginPath.mjs';

test('resolves the development plugin folder from the manifest id', () => {
  assert.equal(
    resolveObsidianPluginPath('/vault', { id: 'realclaudian' }),
    '/vault/.obsidian/plugins/realclaudian',
  );
});
