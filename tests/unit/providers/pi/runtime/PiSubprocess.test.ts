jest.mock('cross-spawn', () => jest.fn());

import { createMockChildProcess, type MockChildProcess } from '@test/helpers/MockChildProcess';
import spawn from 'cross-spawn';

import { PiSubprocess } from '@/providers/pi/runtime/PiSubprocess';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('PiSubprocess', () => {
  const originalPlatform = process.platform;
  let proc: MockChildProcess;

  beforeEach(() => {
    jest.clearAllMocks();
    proc = createMockChildProcess();
    proc.kill.mockImplementation((signal) => {
      proc.killed = signal === 'SIGKILL';
      return true;
    });
    mockSpawn.mockReturnValue(proc);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    jest.useRealTimers();
  });

  it('spawns Pi RPC with the launch spec args, cwd, stdio, and enhanced PATH', () => {
    const subprocess = new PiSubprocess({
      args: ['--mode', 'rpc'],
      command: '/opt/pi/bin/pi',
      cwd: '/vault',
      env: { PATH: '/usr/bin' },
    });

    subprocess.start();

    expect(mockSpawn).toHaveBeenCalledWith('/opt/pi/bin/pi', ['--mode', 'rpc'], expect.objectContaining({
      cwd: '/vault',
      stdio: 'pipe',
      windowsHide: true,
      env: expect.objectContaining({
        PATH: expect.stringContaining('/usr/bin'),
      }),
    }));
  });

  it('fails closed for an unverified Windows command shim', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(() => new PiSubprocess({
      args: ['--mode', 'rpc'],
      command: '/missing/pi.cmd',
      cwd: 'C:\\Vault',
      env: { PATH: 'C:\\Windows\\System32' },
    })).toThrow('could not be resolved to its Node.js entry point');
  });

  it('keeps a bounded stderr snapshot for runtime errors', () => {
    const subprocess = new PiSubprocess({
      args: ['--mode', 'rpc'],
      command: 'pi',
      cwd: '/vault',
      env: {},
    });
    subprocess.start();

    proc.stderr.emit('data', 'a'.repeat(9_000));

    expect(subprocess.getStderrSnapshot()).toHaveLength(8_000);
  });

  it('notifies close listeners and escalates shutdown after timeout', async () => {
    jest.useFakeTimers();
    const subprocess = new PiSubprocess({
      args: ['--mode', 'rpc'],
      command: 'pi',
      cwd: '/vault',
      env: {},
    });
    const onClose = jest.fn();
    subprocess.onClose(onClose);
    subprocess.start();

    const shutdown = subprocess.shutdown();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    jest.advanceTimersByTime(3_000);
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');

    proc.exitCode = 1;
    proc.emit('exit', 1, 'SIGKILL');
    await shutdown;

    expect(onClose).toHaveBeenCalledWith(expect.any(Error));
  });

  it('settles after a final deadline when no exit follows SIGKILL', async () => {
    jest.useFakeTimers();
    const subprocess = new PiSubprocess({
      args: ['--mode', 'rpc'],
      command: 'pi',
      cwd: '/vault',
      env: {},
    });
    subprocess.start();

    const shutdown = subprocess.shutdown();
    jest.advanceTimersByTime(6_000);

    await expect(shutdown).resolves.toBeUndefined();
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('shares one shutdown sequence across repeated calls', async () => {
    const subprocess = new PiSubprocess({
      args: ['--mode', 'rpc'],
      command: 'pi',
      cwd: '/vault',
      env: {},
    });
    subprocess.start();

    const first = subprocess.shutdown();
    const second = subprocess.shutdown();
    expect(proc.kill).toHaveBeenCalledTimes(1);

    proc.exitCode = 0;
    proc.emit('exit', 0, 'SIGTERM');
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });
});
