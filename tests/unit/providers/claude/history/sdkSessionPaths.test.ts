/** @jest-environment jsdom */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { readSDKSessionFile } from '@/providers/claude/history/sdkSessionPaths';



describe('readSDKSessionFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('yields while parsing a large transcript and retains records around compaction', async () => {
    const userMessages = Array.from({ length: 200 }, (_, index) => ({
      type: 'user',
      uuid: `user-${index}`,
      message: { content: '汉字🙂'.repeat(2048) },
    }));
    const compactBoundary = {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'compact-boundary',
      parentUuid: null,
    };
    const records = [...userMessages.slice(0, 100), compactBoundary, ...userMessages.slice(100)];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-history-stream-'));
    const file = path.join(dir, 'history.jsonl');
    fs.writeFileSync(file, records.map(record => JSON.stringify(record)).join('\n'));

    const original = JSON.parse;
    let parsedAtHeartbeat = 0;
    let resolveHeartbeat!: () => void;
    const heartbeat = new Promise<void>(resolve => { resolveHeartbeat = resolve; });
    const parse = jest.spyOn(JSON, 'parse').mockImplementation((...args: Parameters<typeof JSON.parse>) => {
      if (parse.mock.calls.length === 1) window.setTimeout(() => {
        parsedAtHeartbeat = parse.mock.calls.length;
        resolveHeartbeat();
      }, 0);
      return original(...args);
    });

    try {
      const result = await readSDKSessionFile(file);
      await heartbeat;

      expect(result.messages).toHaveLength(records.length);
      expect(result.messages[100].uuid).toBe('compact-boundary');
      expect(parsedAtHeartbeat).toBeGreaterThan(0);
      expect(parsedAtHeartbeat).toBeLessThan(records.length);
    } finally {
      parse.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
