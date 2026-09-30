import {
  buildOpencodeHttpArguments,
  OpencodeSseDecoder,
} from '@/providers/opencode/http/OpencodeHttpClient';

describe('OpenCode HTTP launch arguments', () => {
  it('appends configured literal arguments after the managed serve flags', () => {
    expect(buildOpencodeHttpArguments(['--flag', 'value with spaces'])).toEqual([
      'serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0', '--flag', 'value with spaces',
    ]);
  });
});

describe('OpenCode SSE decoding', () => {
  it('decodes split CRLF frames and multiline data fields', () => {
    const onEvent = jest.fn();
    const decoder = new OpencodeSseDecoder(onEvent);

    decoder.push('data: {"type":\r');
    decoder.push('\ndata: "message.updated",\r\ndata: "data":{"id":"session"}}\r\n\r\n');

    expect(onEvent).toHaveBeenCalledWith({
      type: 'message.updated',
      data: { id: 'session' },
    });
  });
});
