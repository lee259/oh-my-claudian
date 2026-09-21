import { PassThrough } from 'node:stream';

import { subscribePiJsonlLines, writePiJsonl } from '@/providers/pi/runtime/PiJsonl';

describe('PiJsonl', () => {
  it('splits only on LF and strips CR', () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    subscribePiJsonlLines(stream, line => lines.push(line));
    const separator = String.fromCharCode(0x2028);
    const paragraphSeparator = String.fromCharCode(0x2029);

    stream.write(`{"a":1}\r\n{"b":"line${separator}separator${paragraphSeparator}still same record"}\n`);

    expect(lines).toEqual([
      '{"a":1}',
      `{"b":"line${separator}separator${paragraphSeparator}still same record"}`,
    ]);
  });

  it('emits trailing buffered records on end', async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    subscribePiJsonlLines(stream, line => lines.push(line));

    stream.write('{"a":1}');
    stream.end();
    await new Promise(resolve => setImmediate(resolve));

    expect(lines).toEqual(['{"a":1}']);
  });

  it('preserves UTF-8 characters split across stream chunks', () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    subscribePiJsonlLines(stream, line => lines.push(line));
    const record = '{"text":"你好"}\n';
    const bytes = Buffer.from(record, 'utf8');
    const splitAt = Buffer.byteLength('{"text":"') + 1;

    stream.write(bytes.subarray(0, splitAt));
    stream.write(bytes.subarray(splitAt));

    expect(lines).toEqual(['{"text":"你好"}']);
  });

  it('writes JSONL records', () => {
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', chunk => chunks.push(chunk.toString('utf8')));

    writePiJsonl(output, { type: 'ping' });

    expect(chunks.join('')).toBe('{"type":"ping"}\n');
  });
});
