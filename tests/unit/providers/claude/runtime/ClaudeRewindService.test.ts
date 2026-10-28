import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { createClaudeRewindBackup } from '@/providers/claude/runtime/ClaudeRewindService';

describe('Claude rewind backups', () => {
  it('retains the recovery copy when restoration fails and removes it after a successful retry', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-rewind-test-'));
    const parent = path.join(root, 'folder');
    const target = path.join(parent, 'note.md');
    await fs.mkdir(parent);
    await fs.writeFile(target, 'original');
    const backup = await createClaudeRewindBackup([target], root);
    expect(backup).not.toBeNull();
    await fs.rm(parent, { recursive: true });
    await fs.writeFile(parent, 'blocks restoration');
    const failure = await backup!.restore().then(() => '', (error: unknown) => String(error));
    const match = failure.match(/Backup retained at: (.+)/);
    expect(match).not.toBeNull();
    const recoveryPath = match![1];
    await backup!.cleanup();
    expect(await fs.readFile(path.join(recoveryPath, '0'), 'utf8')).toBe('original');
    await fs.rm(parent);
    await backup!.restore();
    expect(await fs.readFile(target, 'utf8')).toBe('original');
    await backup!.cleanup();
    await expect(fs.access(recoveryPath)).rejects.toThrow();
    await fs.rm(root, { recursive: true, force: true });
  });
});
