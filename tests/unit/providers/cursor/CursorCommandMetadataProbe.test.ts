import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AcpSessionNotification } from '@/providers/acp';
import {
  CursorCommandMetadataProbe,
  normalizeCursorRuntimeCommands,
} from '@/providers/cursor/app/CursorCommandMetadataProbe';
import type {
  CursorAcpSessionKernel,
  CursorAcpSessionKernelOptions,
} from '@/providers/cursor/execution/CursorAcpSessionKernel';
import { removeUnusedCursorProbeSession } from '@/providers/cursor/metadata/CursorMetadataSession';

function createKernel(
  options: CursorAcpSessionKernelOptions,
  advertise: (notify: (notification: AcpSessionNotification) => void) => void,
): CursorAcpSessionKernel & { dispose: jest.Mock } {
  return {
    cancel: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn().mockResolvedValue(undefined),
    openSession: jest.fn(async () => {
      setTimeout(() => advertise(options.onNotification), 0);
      return { sessionId: 'probe-session' };
    }),
    prompt: jest.fn(),
    setConfigOption: jest.fn(),
    setMode: jest.fn(),
    setModel: jest.fn(),
  };
}

const host = {
  app: { vault: { adapter: { basePath: '/vault' } } },
  settings: {},
} as never;

describe('CursorCommandMetadataProbe', () => {
  it('returns commands advertised after the metadata session opens and releases it', async () => {
    let kernel: ReturnType<typeof createKernel> | undefined;
    const removeProbeSession = jest.fn().mockResolvedValue(undefined);
    const probe = new CursorCommandMetadataProbe(host, {
      createKernel: (options) => {
        kernel = createKernel(options, notify => notify({
          sessionId: 'probe-session',
          update: {
            availableCommands: [
              { description: 'Copy the last request ID', name: 'copy-request-id' },
              { description: 'Simplify code', name: 'simplify' },
            ],
            sessionUpdate: 'available_commands_update',
          },
        }));
        return kernel;
      },
      removeProbeSession,
    });

    await expect(probe.load()).resolves.toEqual([
      expect.objectContaining({ name: 'copy-request-id' }),
      expect.objectContaining({ name: 'simplify' }),
    ]);
    expect(kernel?.dispose).toHaveBeenCalledTimes(1);
    expect(removeProbeSession).toHaveBeenCalledWith('probe-session');
  });

  it('fails when Cursor does not advertise commands for its metadata session', async () => {
    const removeProbeSession = jest.fn().mockResolvedValue(undefined);
    const probe = new CursorCommandMetadataProbe(host, {
      commandTimeoutMs: 10,
      createKernel: options => createKernel(options, notify => notify({
        sessionId: 'other-session',
        update: {
          availableCommands: [{ description: 'Stale', name: 'stale' }],
          sessionUpdate: 'available_commands_update',
        },
      })),
      removeProbeSession,
    });

    await expect(probe.load()).rejects.toThrow('Cursor did not advertise commands');
    expect(removeProbeSession).toHaveBeenCalledWith('probe-session');
  });
});

describe('removeUnusedCursorProbeSession', () => {
  async function createSession(files: string[]): Promise<{ home: string; dir: string }> {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-probe-'));
    const dir = path.join(home, '.cursor', 'acp-sessions', 'probe-session');
    await fs.mkdir(dir, { recursive: true });
    for (const file of files) await fs.writeFile(path.join(dir, file), '{}');
    return { dir, home };
  }

  it('removes a prompt-less session that only contains metadata', async () => {
    const { dir, home } = await createSession(['meta.json']);

    await removeUnusedCursorProbeSession('probe-session', home);

    await expect(fs.stat(dir)).rejects.toThrow();
  });

  it('keeps a session that has a transcript store', async () => {
    const { dir, home } = await createSession(['meta.json', 'store.db']);

    await removeUnusedCursorProbeSession('probe-session', home);

    await expect(fs.readdir(dir)).resolves.toEqual(['meta.json', 'store.db']);
  });

  it('ignores unsafe session ids', async () => {
    const { dir, home } = await createSession(['meta.json']);

    await removeUnusedCursorProbeSession('../probe-session', home);

    await expect(fs.readdir(dir)).resolves.toEqual(['meta.json']);
  });
});

describe('normalizeCursorRuntimeCommands', () => {
  it('classifies Cursor skill scopes from the advertised description suffix', () => {
    expect(normalizeCursorRuntimeCommands([
      { description: 'Copy the last request ID to clipboard', name: 'copy-request-id' },
      { description: 'Find low-info comments. (global)', name: 'simplify' },
      { description: 'Set a goal. (builtin skill)', name: 'goal' },
      { description: 'Make a cover. (project skill)', name: 'baoyu-cover-image' },
      { description: 'Maintain a wiki. (user skill)', name: 'llm-wiki' },
    ]).map(command => [command.name, command.kind, command.description])).toEqual([
      ['copy-request-id', 'command', 'Copy the last request ID to clipboard'],
      ['simplify', 'command', 'Find low-info comments. (global)'],
      ['goal', 'skill', 'Set a goal.'],
      ['baoyu-cover-image', 'skill', 'Make a cover.'],
      ['llm-wiki', 'skill', 'Maintain a wiki.'],
    ]);
  });
});
