import { buildOpencodeHttpArguments } from '@/providers/opencode/http/OpencodeHttpClient';

describe('OpenCode HTTP launch arguments', () => {
  it('appends configured literal arguments after the managed serve flags', () => {
    expect(buildOpencodeHttpArguments(['--flag', 'value with spaces'])).toEqual([
      'serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0', '--flag', 'value with spaces',
    ]);
  });
});
