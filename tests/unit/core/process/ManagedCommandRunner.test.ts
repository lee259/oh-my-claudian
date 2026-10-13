import type { spawn } from 'node:child_process';

import { createMockChildProcess, type MockChildProcess } from '@test/helpers/MockChildProcess';

import { ManagedCommandRunner } from '@/core/process/ManagedCommandRunner';

const mockSpawn = jest.fn() as jest.MockedFunction<typeof spawn>;

function runCommand(overrides: Partial<Parameters<ManagedCommandRunner['run']>[0]> = {}) {
  return new ManagedCommandRunner().run({
    args: ['models'],
    command: '/usr/bin/provider',
    cwd: '/workspace',
    env: { PATH: '/usr/bin' },
    spawn: mockSpawn,
    stdoutLimitBytes: 1024,
    timeoutMs: 1_000,
    ...overrides,
  });
}

describe.each(['darwin', 'win32'] as const)('ManagedCommandRunner on %s', platform => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let proc: MockChildProcess;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    jest.clearAllMocks();
    proc = createMockChildProcess();
    mockSpawn.mockReturnValue(proc);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    jest.useRealTimers();
  });

  it('collects stdout and resolves from the final close state', async () => {
    const pending = runCommand();
    proc.stdout.emit('data', Buffer.from('{"models":['));
    proc.stdout.emit('data', ']}');
    proc.emit('close', 0, null);

    await expect(pending).resolves.toEqual({
      exitCode: 0,
      stdout: '{"models":[]}',
    });
  });

  it('returns an error termination for non-zero exits', async () => {
    const pending = runCommand();
    proc.emit('exit', 1, null);
    proc.emit('close', 1, null);

    await expect(pending).resolves.toEqual({
      exitCode: 1,
      stdout: '',
    });
  });

  it('collects stderr when captureStderr is enabled', async () => {
    const pending = runCommand({ captureStderr: true });
    expect(mockSpawn).toHaveBeenCalledWith('/usr/bin/provider', ['models'], expect.objectContaining({
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    proc.stdout.emit('data', 'version 1.2.3');
    proc.stderr.emit('data', Buffer.from('warning: ignored'));
    proc.emit('close', 0, null);

    await expect(pending).resolves.toEqual({
      exitCode: 0,
      stdout: 'version 1.2.3',
      stderr: 'warning: ignored',
    });
  });

  it('does not expose stderr when captureStderr is disabled', async () => {
    const pending = runCommand();
    proc.stderr.emit('data', 'should not be captured');
    proc.emit('close', 0, null);

    await expect(pending).resolves.toEqual({
      exitCode: 0,
      stdout: '',
    });
  });

  it('aborts before spawning when the signal is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(runCommand({ signal: controller.signal })).resolves.toEqual({
      exitCode: null,
      stdout: '',
      termination: 'abort',
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('stops collecting output after the configured limit', async () => {
    const pending = runCommand({ stdoutLimitBytes: 4 });
    proc.stdout.emit('data', '12345');

    await expect(pending).resolves.toEqual({
      exitCode: null,
      stdout: '',
      termination: 'output-limit',
    });
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('bounds the combined stdout and stderr of a noisy updater', async () => {
    const pending = runCommand({ captureStderr: true, stdoutLimitBytes: 4 });
    proc.stdout.emit('data', '12');
    proc.stderr.emit('data', '345');
    await expect(pending).resolves.toMatchObject({ termination: 'output-limit' });
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('keeps upstream output when an updater times out', async () => {
    jest.useFakeTimers();
    const pending = runCommand({ captureStderr: true });
    proc.stderr.emit('data', 'npm ERR! unable to download package');
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ termination: 'timeout', stderr: 'npm ERR! unable to download package' });
  });

  it('does not kill a verbose updater when bounded tail capture is requested', async () => {
    const pending = runCommand({ captureStderr: true, stdoutLimitBytes: 4, outputLimitBehavior: 'truncate' } as never);
    proc.stdout.emit('data', 'progress output');
    proc.stderr.emit('data', 'done');
    proc.emit('close', 0, null);
    await expect(pending).resolves.toMatchObject({ exitCode: 0, stderr: 'done', outputTruncated: true });
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it('returns the real OS launch error instead of a generic error termination', async () => {
    const pending = runCommand();
    proc.emit('error', new Error('spawn /custom/codex ENOENT'));
    proc.emit('close', null, null);
    await expect(pending).resolves.toMatchObject({ termination: 'error', error: 'spawn /custom/codex ENOENT' });
  });

});
