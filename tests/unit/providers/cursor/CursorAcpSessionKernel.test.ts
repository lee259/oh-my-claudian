jest.mock('cross-spawn', () => jest.fn());

import { createMockChildProcess } from '@test/helpers/MockChildProcess';
import spawn from 'cross-spawn';

import type { ProviderSessionConfig } from '@/core/execution';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import { DefaultCursorAcpSessionKernel } from '@/providers/cursor/execution/CursorAcpSessionKernel';

const mockSpawn = jest.mocked(spawn);

function createKernel(cliPath: string | null = '/configured/agent', parameterizedModels = false) {
  return new DefaultCursorAcpSessionKernel({
    parameterizedModels,
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

function serveCli(help: string, exitCode = 0, extensionResult: unknown = { models: [] }, extensionError?: { code: number; message: string }, modelId = 'grok-4.7') {
  const requests: Array<{ method: string; params: unknown }> = [];
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
        requests.push(request);
        proc.stdout.write(`${JSON.stringify({
          id: request.id,
          jsonrpc: '2.0',
          ...(request.method === 'cursor/list_available_models'
            ? extensionError ? { error: extensionError } : { result: extensionResult }
            : { result: request.method === 'initialize' ? { protocolVersion: 1 } : { sessionId: 'cursor-session', models: { availableModels: [{ modelId, name: modelId }] } } }),
        })}\n`);
      });
    }
    return proc;
  });
  return requests;
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

  it('negotiates parameterized models and configures each native parameter in order', async () => {
    const requests = serveCli('Start the Cursor Agent');
    const kernel = createKernel('/configured/agent', true);
    try {
      await kernel.connect();
      await kernel.openSession();
      await kernel.setModel({ sessionId: 'session', modelId: 'grok-4.7[context=256k,reasoning_effort=low,fast=true]' });
      expect(requests).toEqual([
        expect.objectContaining({ method: 'initialize', params: expect.objectContaining({ clientCapabilities: expect.objectContaining({ _meta: { parameterizedModelPicker: true } }) }) }),
        expect.objectContaining({ method: 'session/new' }),
        expect.objectContaining({ method: 'session/set_model', params: { sessionId: 'session', modelId: 'grok-4.7' } }),
        ...[['context', '256k'], ['reasoning_effort', 'low'], ['fast', 'true']].map(([configId, value]) => expect.objectContaining({
          method: 'session/set_config_option', params: { sessionId: 'session', configId, value, type: 'select' },
        })),
      ]);
    } finally { await kernel.dispose(); }
  });

  it('retains the original model setter when an older runtime ignores parameterized model support', async () => {
    const modelId = 'grok-4.7[reasoning_effort=high]';
    const requests = serveCli('Start the Cursor Agent', 0, null, undefined, modelId);
    const kernel = createKernel('/configured/agent', true);
    try {
      await kernel.connect();
      await kernel.openSession();
      await kernel.setModel({ sessionId: 'session', modelId });
      expect(requests.at(-1)).toMatchObject({ method: 'session/set_model', params: { sessionId: 'session', modelId } });
      expect(requests.some(request => request.method === 'session/set_config_option')).toBe(false);
    } finally { await kernel.dispose(); }
  });

  it('reads Cursor model parameters through its native extension', async () => {
    const catalog = { models: [{ value: 'grok-4.7', configOptions: [] }] };
    serveCli('Start the Cursor Agent', 0, catalog);
    const kernel = createKernel();
    try {
      await kernel.connect();
      await expect(kernel.listAvailableModels()).resolves.toEqual(catalog);
    } finally { await kernel.dispose(); }
  });

  it('ignores an unsupported extension on older Cursor versions', async () => {
    serveCli('Start the Cursor Agent', 0, null, { code: -32601, message: 'Extension error' });
    const kernel = createKernel();
    try {
      await kernel.connect();
      await expect(kernel.listAvailableModels()).resolves.toBeNull();
    } finally { await kernel.dispose(); }
  });

  it('propagates other extension failures', async () => {
    serveCli('Start the Cursor Agent', 0, null, { code: -32603, message: 'Extension error' });
    const kernel = createKernel();
    try {
      await kernel.connect();
      await expect(kernel.listAvailableModels()).rejects.toThrow('Extension error');
    } finally { await kernel.dispose(); }
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
