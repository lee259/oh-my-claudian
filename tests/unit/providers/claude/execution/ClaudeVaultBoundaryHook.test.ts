import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { createVaultBoundaryHook } from '@/providers/claude/execution/ClaudeExecutionRequestEncoder';

describe('createVaultBoundaryHook', () => {
  it('asks before an Edit targets a file outside the vault', async () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'claudian-vault-hook-'));
    const vaultRoot = path.join(testRoot, 'vault');
    mkdirSync(vaultRoot);

    try {
      const hook = createVaultBoundaryHook(vaultRoot).hooks[0];
      await expect(hook({
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: path.join(testRoot, 'outside.md') },
        cwd: vaultRoot,
        session_id: 'session',
        transcript_path: '',
      } as never, 'tool-1', {
        signal: new AbortController().signal,
      } as never)).resolves.toEqual(expect.objectContaining({
        continue: false,
        hookSpecificOutput: expect.objectContaining({
          permissionDecision: 'ask',
        }),
      }));
    } finally {
      rmSync(testRoot, { force: true, recursive: true });
    }
  });

  it('asks before a Bash command writes to a file outside the vault', async () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'claudian-vault-hook-'));
    const vaultRoot = path.join(testRoot, 'vault');
    const outsideFile = path.join(testRoot, 'outside.md');
    mkdirSync(vaultRoot);

    try {
      const hook = createVaultBoundaryHook(vaultRoot).hooks[0];
      await expect(hook({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: `sed -i '' 's/a/b/' ${outsideFile}` },
        cwd: vaultRoot,
        session_id: 'session',
        transcript_path: '',
      } as never, 'tool-2', {
        signal: new AbortController().signal,
      } as never)).resolves.toEqual(expect.objectContaining({
        continue: false,
        hookSpecificOutput: expect.objectContaining({
          permissionDecision: 'ask',
        }),
      }));
    } finally {
      rmSync(testRoot, { force: true, recursive: true });
    }
  });
});
