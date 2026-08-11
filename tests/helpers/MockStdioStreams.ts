import { PassThrough } from 'node:stream';

export interface MockStdioStreams {
  input: PassThrough;
  output: PassThrough;
}

export function createMockStdioStreams(): MockStdioStreams {
  return {
    input: new PassThrough(),
    output: new PassThrough(),
  };
}
