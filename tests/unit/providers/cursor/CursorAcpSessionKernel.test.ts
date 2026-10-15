jest.mock('cross-spawn', () => jest.fn());

import { createMockChildProcess } from '@test/helpers/MockChildProcess';
import spawn from 'cross-spawn';

import type { ProviderSessionConfig } from '@/core/execution';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import { DefaultCursorAcpSessionKernel } from '@/providers/cursor/execution/CursorAcpSessionKernel';

const mockSpawn = jest.mocked(spawn);

function createKernel(cliPath: string | null = '/configured/agent') {
  return new DefaultCursorAcpSessionKernel({
    config: { vaultWorkingDirectory: '/vault' } as ProviderSessionConfig,
    getActiveTurnId: () => null,
    onClosed: jest.fn(),
    onNotification: jest.fn(),
    plugin: {
      settings: {},
      getResolvedProviderCliPath: async () => cliPath,
      getActiveEnvironmentVariables: () => 'CURSOR_TEST_ENV=provider-value',
    } as unknown as ProviderHost,
    sessionInstanceId: 'test-session',
  });
}

function serveCli(help: string, exitCode = 0) {
  mockSpawn.mockImplementation((_command, args) => {
    const proc = createMockChildProcess();
    proc.kill.mockImplementation(() => {
      proc.emit('exit', 0, null);
      proc.emit('close', 0, null);
      return true;
    });
    if (args?.[0] === '--help') {
      queueMicrotask(() => {
        proc.stdout.write(help);
        proc.emit('close', exitCode, null);
      });
    } else {
      proc.stdin.on('data', chunk => {
        const request = JSON.parse(String(chunk));
        proc.stdout.write(`${JSON.stringify({
          id: request.id,
          jsonrpc: '2.0',
          result: request.method === 'initialize' ? { protocolVersion: 1 } : { sessionId: 'cursor-session' },
        })}\n`);
      });
    }
    return proc;
  });
}

describe('Cursor ACP executable verification', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('does not bypass discovery with a bare agent command when no CLI was resolved', async () => {
    serveCli('Start the Cursor Agent');
    const kernel = createKernel(null);
    try {
      await expect(kernel.connect()).rejects.toThrow('not found');
      expect(mockSpawn).not.toHaveBeenCalled();
    } finally {
      await kernel.dispose();
    }
  });

  it('rejects a configured Grok executable before starting ACP or opening a session', async () => {
    serveCli('Grok Build TUI\nACP output\ncursor-worker: Cursor private worker');
    const kernel = createKernel();
    try {
      await expect(kernel.connect()).rejects.toThrow('does not match Cursor');
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(mockSpawn).toHaveBeenCalledWith('/configured/agent', ['--help'], expect.anything());
    } finally {
      await kernel.dispose();
    }
  });

  it('verifies an older agent installation and opens its session with the provider environment', async () => {
    serveCli('Start the Cursor Agent\nUsage: agent [options]');
    const kernel = createKernel();
    try {
      await kernel.connect();
      await expect(kernel.openSession()).resolves.toMatchObject({ sessionId: 'cursor-session' });
      expect(mockSpawn).toHaveBeenNthCalledWith(1, '/configured/agent', ['--help'], expect.objectContaining({
        env: expect.objectContaining({ CURSOR_TEST_ENV: 'provider-value' }),
      }));
      expect(mockSpawn).toHaveBeenNthCalledWith(2, '/configured/agent', ['acp'], expect.objectContaining({
        env: expect.objectContaining({ CURSOR_TEST_ENV: 'provider-value' }),
      }));
    } finally {
      await kernel.dispose();
    }
  });

  it('aborts an identity probe on disposal without starting ACP', async () => {
    const proc = createMockChildProcess();
    proc.kill.mockImplementation(() => {
      proc.emit('close', 0, null);
      return true;
    });
    mockSpawn.mockReturnValue(proc);
    const kernel = createKernel();
    const connecting = kernel.connect().catch((error: unknown) => error);
    await Promise.resolve();
    await kernel.dispose();
    await expect(connecting).resolves.toEqual(new Error('Cursor ACP kernel is disposed'));
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(proc.kill).toHaveBeenCalled();
  });

  it('reports a failed help probe separately from a provider mismatch', async () => {
    serveCli('Start the Cursor Agent', 7);
    const kernel = createKernel();
    try {
      await expect(kernel.connect()).rejects.toThrow('Could not verify Cursor Agent CLI (exit code 7)');
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    } finally {
      await kernel.dispose();
    }
  });
});
