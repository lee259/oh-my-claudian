import { LineBuffer } from '@/utils/LineBuffer';

describe('LineBuffer', () => {
  it('emits complete lines across fragments and strips CRLF', () => {
    const buffer = new LineBuffer();
    const lines: string[] = [];

    buffer.push('first\r', line => lines.push(line));
    buffer.push('\nsecond', line => lines.push(line));
    buffer.push(' line\n', line => lines.push(line));

    expect(lines).toEqual(['first', 'second line']);
    expect(buffer.bufferedLength).toBe(0);
  });

  it('retains trailing content until taken', () => {
    const buffer = new LineBuffer();

    buffer.push('unfinished\r', () => {});

    expect(buffer.bufferedLength).toBe('unfinished\r'.length);
    expect(buffer.take()).toBe('unfinished');
    expect(buffer.bufferedLength).toBe(0);
  });

  it('rejects a line above its configured limit', () => {
    const buffer = new LineBuffer(4);

    expect(() => buffer.push('12345', () => {})).toThrow('Line exceeded the size limit.');
  });
});
