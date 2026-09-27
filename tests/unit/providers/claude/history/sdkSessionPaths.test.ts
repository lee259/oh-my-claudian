/** @jest-environment jsdom */

import { readFile } from 'fs/promises';

import { readSDKSessionFile } from '@/providers/claude/history/sdkSessionPaths';

jest.mock('fs/promises');

const mockReadFile = jest.mocked(readFile);

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
    mockReadFile.mockResolvedValue(records.map(record => JSON.stringify(record)).join('\n') as never);

    const parse = jest.spyOn(JSON, 'parse');
    let parsedAtHeartbeat = 0;
    const heartbeat = new Promise<void>((resolve) => {
      window.setTimeout(() => {
        parsedAtHeartbeat = parse.mock.calls.length;
        resolve();
      }, 0);
    });

    try {
      const result = await readSDKSessionFile('/session.jsonl');
      await heartbeat;

      expect(result.messages).toHaveLength(records.length);
      expect(result.messages[100].uuid).toBe('compact-boundary');
      expect(parsedAtHeartbeat).toBeGreaterThan(0);
      expect(parsedAtHeartbeat).toBeLessThan(records.length);
    } finally {
      parse.mockRestore();
    }
  });
});
