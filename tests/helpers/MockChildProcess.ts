import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

export type MockChildProcess = Omit<
  ChildProcessWithoutNullStreams,
  'exitCode' | 'killed' | 'kill' | 'pid' | 'signalCode'
> & {
  exitCode: number | null;
  killed: boolean;
  kill: jest.Mock<boolean, [signal?: NodeJS.Signals | number]>;
  pid: number;
  stderr: PassThrough;
  stdin: PassThrough;
  stdout: PassThrough;
  signalCode: NodeJS.Signals | null;
};

export function createMockChildProcess(): MockChildProcess {
  const process = new EventEmitter() as unknown as MockChildProcess;
  Object.assign(process, {
    exitCode: null,
    killed: false,
    pid: 12345,
    signalCode: null,
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    stdout: new PassThrough(),
  });
  process.kill = jest.fn().mockReturnValue(true);
  return process;
}
