import { PassThrough } from 'node:stream';

import { writePiJsonl } from '@/providers/pi/runtime/PiJsonl';

describe('PiJsonl', () => {
  it('writes JSONL records', () => {
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', chunk => chunks.push(chunk.toString('utf8')));

    writePiJsonl(output, { type: 'ping' });

    expect(chunks.join('')).toBe('{"type":"ping"}\n');
  });
});
