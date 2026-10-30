import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Conversation } from '@/core/types';
import { HermesConversationHistoryService } from '@/providers/hermes/history/HermesConversationHistoryService';

describe('Hermes persisted history', () => {
  it('reads only active messages from the matching native session without modifying the database', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-history-'));
    const db = path.join(home, 'state.db');
    const setup = spawnSync(process.execPath, ['-e', `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1]);
      db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL, reasoning TEXT, reasoning_content TEXT, active INTEGER)");
      const add = db.prepare('INSERT INTO messages (id, session_id, role, content, timestamp, active) VALUES (?, ?, ?, ?, ?, ?)');
      add.run(1, 'session-1', 'user', 'First question', 100, 1);
      add.run(2, 'session-1', 'assistant', 'First answer', 101, 1);
      add.run(3, 'other', 'user', 'Unrelated', 102, 1);
      add.run(4, 'session-1', 'user', 'Deleted turn', 103, 0);
      db.close();
    `, db], { encoding: 'utf8' });
    expect(setup.status).toBe(0);
    const before = fs.readFileSync(db);
    const conversation: Conversation = { id: 'c1', providerId: 'hermes', sessionId: 'session-1', title: 'Hermes', createdAt: 1, lastActivityAt: 2, messages: [] };
    try {
      await new HermesConversationHistoryService().hydrateConversationHistory(conversation, null, { environment: { HERMES_HOME: home } });
      expect(conversation.messages.map(message => [message.role, message.content, message.timestamp])).toEqual([
        ['user', 'First question', 100_000], ['assistant', 'First answer', 101_000],
      ]);
      expect(fs.readFileSync(db)).toEqual(before);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});
