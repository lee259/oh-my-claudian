jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'node:child_process';

import { ManagedCommandRunner } from '@/core/process/ManagedCommandRunner';
import { createMockChildProcess, type MockChildProcess } from '@test/helpers/MockChildProcess';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

function runCommand(overrides: Partial<Parameters<ManagedCommandRunner['run']>[0]> = {}) {
  return new ManagedCommandRunner().run({
    args: ['models'],
    command: '/usr/bin/provider',
    cwd: '/workspace',
    env: { PATH: '/usr/bin' },
    stdoutLimitBytes: 1024,
    timeoutMs: 1_000,
    ...overrides,
  });
}

describe('ManagedCommandRunner', () => {
  let proc: MockChildProcess;

  beforeEach(() => {
    jest.clearAllMocks();
    proc = createMockChildProcess();
    mockSpawn.mockReturnValue(proc);
  });

  afterEach(() => {
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
});
