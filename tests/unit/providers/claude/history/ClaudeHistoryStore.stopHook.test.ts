import type * as nativeFsType from 'node:fs';
import * as fs from 'node:fs/promises';
import type * as streamType from 'node:stream';

import { loadSDKSessionMessages } from '@/providers/claude/history/ClaudeHistoryStore';

jest.mock('node:fs/promises');
jest.mock('node:fs', () => ({
  ...jest.requireActual<typeof nativeFsType>('node:fs'),
  createReadStream: (file: string) => {
    const { Readable } = jest.requireActual<typeof streamType>('node:stream');
    return Readable.from((async function* () { yield await fs.readFile(file, 'utf-8'); })());
  },
}));

const readFile = jest.mocked(fs.readFile);

beforeEach(() => jest.resetAllMocks());

it('restores Stop hook feedback as a boundary inside the same turn', async () => {
  const entries = [
    { type: 'user', uuid: 'u', timestamp: '2026-11-13T10:00:00Z', message: { content: 'Fix it' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u', timestamp: '2026-11-13T10:00:01Z',
      message: { content: [{ type: 'text', text: 'Long answer.' }] } },
    { type: 'user', uuid: 'hook', parentUuid: 'a1', isSynthetic: true, timestamp: '2026-11-13T10:00:02Z',
      message: { content: [{ type: 'text', text: 'Stop hook feedback:\n[check]: Run the tests.\n' }] } },
    { type: 'assistant', uuid: 'a2', parentUuid: 'hook', timestamp: '2026-11-13T10:00:03Z',
      message: { content: [{ type: 'text', text: 'Follow-up.' }] } },
  ];
  readFile.mockResolvedValue(entries.map(entry => JSON.stringify(entry)).join('\n'));

  const result = await loadSDKSessionMessages('/vault', 'session', undefined, '/session.jsonl');

  expect(result.messages).toHaveLength(2);
  expect(result.messages[1]).toMatchObject({
    role: 'assistant',
    contentBlocks: [
      { type: 'text', content: 'Long answer.' },
      { type: 'stop_hook', content: '[check]: Run the tests.' },
      { type: 'text', content: 'Follow-up.' },
    ],
  });
});
