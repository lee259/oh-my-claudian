import type * as streamType from 'node:stream';

import type * as fsType from 'fs';
import type * as osType from 'os';
import type * as pathType from 'path';

const fs = jest.requireActual<typeof fsType>('fs');
const os = jest.requireActual<typeof osType>('os');
const path = jest.requireActual<typeof pathType>('path');

import { forEachJSONLLine } from '@/utils/jsonlFile';

describe('forEachJSONLLine', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-jsonl-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(content: string | Buffer): string {
    const file = path.join(dir, 'history.jsonl');
    fs.writeFileSync(file, content);
    return file;
  }

  async function collect(file: string, maxLineLength?: number): Promise<string[]> {
    const lines: string[] = [];
    await forEachJSONLLine(file, line => { lines.push(line); }, { maxLineLength });
    return lines;
  }

  it('reassembles lines and multibyte characters split across read chunks', async () => {
    // The reader uses 1 MiB chunks; place a 4-byte character across the boundary.
    const first = `${'a'.repeat(1024 * 1024 - 2)}😀b`;
    const file = write(`${first}\r\n{"x":1}\nlast`);

    await expect(collect(file)).resolves.toEqual([first, '{"x":1}', 'last']);
  });

  it('rejects instead of skipping a line longer than the limit', async () => {
    // Skipping would hand consumers a history with a silently missing record.
    const file = write('0\n123456789\n1\n');
    const lines: string[] = [];

    await expect(forEachJSONLLine(file, line => { lines.push(line); }, { maxLineLength: 4 }))
      .rejects.toThrow(new Error('Line exceeded the size limit.'));
    expect(lines).toEqual(['0']);
  });

  it('stops when the handler returns false', async () => {
    const file = write('a\nb\nc\n');
    const lines: string[] = [];

    await forEachJSONLLine(file, line => { lines.push(line); return line !== 'b'; });

    expect(lines).toEqual(['a', 'b']);
  });

  it('stops when the handler returns false on an unterminated final line', async () => {
    const file = write('0');
    const lines: string[] = [];

    await forEachJSONLLine(file, line => { lines.push(line); return false; });

    expect(lines).toEqual(['0']);
  });

  it.each(['0\n', '0'])('rejects with the error the consumer threw for %j', async content => {
    const file = write(content);
    const failure = new Error('consumer failed');
    const lines: string[] = [];

    await expect(forEachJSONLLine(file, line => { lines.push(line); throw failure; })).rejects.toBe(failure);
    expect(lines).toEqual(['0']);
  });

  it('stops before an unread oversized line', async () => {
    const file = write('0\n123456789\n1\n');
    const lines: string[] = [];

    await forEachJSONLLine(file, line => { lines.push(line); return false; }, { maxLineLength: 4 });

    expect(lines).toEqual(['0']);
  });

  it('rejects when the file cannot be read', async () => {
    await expect(collect(path.join(dir, 'missing.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects missing and invalid compressed histories', async () => {
    await expect(collect(path.join(dir, 'missing.jsonl.zst'))).rejects.toMatchObject({ code: 'ENOENT' });
    const invalid = path.join(dir, 'invalid.jsonl.zst');
    fs.writeFileSync(invalid, 'not zstd');
    await expect(collect(invalid)).rejects.toThrow();
  });

  it('honors a pre-existing cancellation and an expired deadline before opening a file', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(forEachJSONLLine('/missing', () => {}, { signal: controller.signal })).rejects.toBe(reason);
    await expect(forEachJSONLLine('/missing', () => {}, { deadline: Date.now() - 1 })).rejects.toThrow('Timed out');
  });

  it('cancels between records in the same chunk', async () => {
    const file = write('one\ntwo\nthree');
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const lines: string[] = [];
    await expect(forEachJSONLLine(file, line => {
      lines.push(line); controller.abort(reason);
    }, { signal: controller.signal })).rejects.toBe(reason);
    expect(lines).toEqual(['one']);
  });

  it.each(['idle', 'total'])('closes a stalled stream when its %s budget expires', async kind => {
    const { Readable } = jest.requireActual<typeof streamType>('node:stream');
    const stalled = new Readable({ read() {} });
    const spy = jest.spyOn(fs, 'createReadStream').mockReturnValue(stalled as fsType.ReadStream);
    try {
      await expect(forEachJSONLLine('fixture', () => {}, kind === 'idle'
        ? { idleTimeoutMs: 10 } : { idleTimeoutMs: 1000, timeoutMs: 10 })).rejects.toThrow('Timed out');
      expect(stalled.destroyed).toBe(true);
    } finally { spy.mockRestore(); }
  });

});
