import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

jest.mock('cross-spawn', () => ({ __esModule: true, default: jest.fn() }));

import spawn from 'cross-spawn';

import { runProcessProbe } from '@/core/process/ProcessProbe';

function childProcess() {
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null,
    signalCode: null,
    killed: false,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn((signal: string) => {
      child.emit('exit', null, signal);
      child.emit('close', null, signal);
      return true;
    }),
  });
  return child;
}

describe('process probe bounds', () => {
  afterEach(() => { jest.useRealTimers(); });

  it('preserves split UTF-8 bytes', async () => {
    const child = childProcess();
    jest.mocked(spawn).mockReturnValueOnce(child as never);
    const result = runProcessProbe({ command: 'test', args: [], cwd: '/tmp', env: {} });
    child.stdout.write(Buffer.from([0xc3]));
    child.stdout.write(Buffer.from([0xa9]));
    child.emit('exit', 0, null);
    child.emit('close', 0, null);

    expect(await result).toBe('é');
  });

  it('terminates an in-flight probe when its owner aborts', async () => {
    const child = childProcess();
    jest.mocked(spawn).mockReturnValueOnce(child as never);
    const controller = new AbortController();
    const result = runProcessProbe({
      command: 'test',
      args: [],
      cwd: '/tmp',
      env: {},
      signal: controller.signal,
    });
    controller.abort();

    expect(await result).toBeNull();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects output beyond the byte limit', async () => {
    const child = childProcess();
    jest.mocked(spawn).mockReturnValueOnce(child as never);
    const result = runProcessProbe({ command: 'test', args: [], cwd: '/tmp', env: {} });
    child.stdout.write('x'.repeat(16_385));

    expect(await result).toBeNull();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
