import * as fs from 'node:fs/promises';

import { loadSDKSessionMessages } from '@/providers/claude/history/ClaudeHistoryStore';

jest.mock('node:fs/promises');

const readFile = jest.mocked(fs.readFile);

beforeEach(() => jest.resetAllMocks());

it('preserves a task notification between the requested response and its automatic follow-up', async () => {
  const entries = [
    { type: 'user', uuid: 'u', timestamp: '2026-09-20T11:29:55Z', message: { content: 'Run a task' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u', timestamp: '2026-09-20T11:30:00Z',
      message: { content: [{ type: 'text', text: 'Waiting for completion.' }] } },
    { type: 'user', uuid: 'notification', parentUuid: 'a1', timestamp: '2026-09-20T11:30:18Z',
      message: { content: '<task-notification><task-id>task-1</task-id><status>completed</status>'
        + '<result>Background command completed.</result></task-notification>' } },
    { type: 'assistant', uuid: 'a2', parentUuid: 'notification', timestamp: '2026-09-20T11:30:23Z',
      message: { content: [{ type: 'text', text: 'Task complete.' }] } },
  ];
  readFile.mockResolvedValue(entries.map(entry => JSON.stringify(entry)).join('\n'));

  const result = await loadSDKSessionMessages('/vault', 'session', undefined, '/session.jsonl');

  expect(result.messages).toHaveLength(3);
  expect(result.messages[1]).toMatchObject({ content: 'Waiting for completion.' });
  expect(result.messages[2]).toMatchObject({
    role: 'assistant',
    isAutomaticResponse: true,
    content: 'Task complete.',
    contentBlocks: [
      { type: 'task_notification', content: 'Background command completed.' },
      { type: 'text', content: 'Task complete.' },
    ],
  });
});
