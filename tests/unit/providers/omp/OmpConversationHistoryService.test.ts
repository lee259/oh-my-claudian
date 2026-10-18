import type * as nativeFsType from 'node:fs';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';

import type { Conversation } from '@/core/types';
import { OmpConversationHistoryService } from '@/providers/omp/history/OmpConversationHistoryService';
import { readOmpSessionFile } from '@/providers/omp/history/OmpHistoryStore';

it('surfaces an OMP read failure and replays the same session when retry succeeds', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-history-'));
  const sessions = path.join(root, 'agent', 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const file = path.join(sessions, 'session-1.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'message', id: 'user-1', message: {
    role: 'user', content: 'Recovered history', timestamp: 1,
  } }));
  const conversation: Conversation = {
    id: 'local', providerId: 'omp', sessionId: 'session-1', title: 'OMP',
    createdAt: 1, lastActivityAt: 1, messages: [],
  };
  const nativeFs = jest.requireActual<typeof nativeFsType>('node:fs');
  const failure = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
  const spy = jest.spyOn(nativeFs, 'createReadStream').mockImplementation(() =>
    new Readable({ read() { this.destroy(failure); } }) as unknown as fs.ReadStream);
  try {
    const service = new OmpConversationHistoryService();
    const context = { environment: { PI_CONFIG_DIR: root } };
    await expect(service.hydrateConversationHistory(conversation, null, context)).rejects.toBe(failure);
    expect(conversation.messages).toEqual([]);
    spy.mockRestore();
    await service.hydrateConversationHistory(conversation, null, context);
    expect(conversation.messages[0]?.content).toBe('Recovered history');
    await expect(readOmpSessionFile(path.join(root, 'missing.jsonl'))).resolves.toEqual([]);
  } finally { spy.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); }
});
