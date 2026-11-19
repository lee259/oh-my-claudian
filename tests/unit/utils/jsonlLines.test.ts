import { PassThrough } from 'node:stream';

import { subscribeJSONLLines } from '@/utils/jsonlLines';

describe('subscribeJSONLLines', () => {
  it('splits only on LF and strips CR', () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    subscribeJSONLLines(stream, line => lines.push(line));
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
    subscribeJSONLLines(stream, line => lines.push(line));

    stream.write('{"a":1}');
    stream.end();
    await new Promise(resolve => setImmediate(resolve));

    expect(lines).toEqual(['{"a":1}']);
  });

  it('preserves UTF-8 characters split across stream chunks', () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    subscribeJSONLLines(stream, line => lines.push(line));
    const record = '{"text":"你好"}\n';
    const bytes = Buffer.from(record, 'utf8');
    const splitAt = Buffer.byteLength('{"text":"') + 1;

    stream.write(bytes.subarray(0, splitAt));
    stream.write(bytes.subarray(splitAt));

    expect(lines).toEqual(['{"text":"你好"}']);
  });

  it('preserves CRLF split across chunks and emits each following record once', () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    subscribeJSONLLines(stream, line => lines.push(line));

    stream.write(Buffer.from('{"value":1}\r'));
    stream.write(Buffer.from('\n{"value":2}\n'));

    expect(lines).toEqual(['{"value":1}', '{"value":2}']);
  });
});
