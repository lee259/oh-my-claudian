import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { loadOpencodeTurnStats } from '@/providers/opencode/history/OpencodeTurnStats';

describe('loadOpencodeTurnStats', () => {
  it.each([1, 2])('reads the current turn from OpenCode v%s storage', async version => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'opencode-throughput-'));
    const databasePath = path.join(root, 'opencode.db');
    const db = new DatabaseSync(databasePath);
    if (version === 1) {
      db.exec(`CREATE TABLE message(id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
        CREATE TABLE part(id TEXT, session_id TEXT, message_id TEXT, data TEXT);`);
      const insert = db.prepare('INSERT INTO message VALUES(?, ?, ?, ?)');
      insert.run('old-user', 'session', 100, JSON.stringify({ role: 'user', time: { created: 100 } }));
      insert.run('old-answer', 'session', 200, JSON.stringify({
        role: 'assistant', parentID: 'old-user', finish: 'stop',
        time: { created: 200, completed: 500 }, tokens: { output: 900, reasoning: 0 },
      }));
      insert.run('user', 'session', 1_000, JSON.stringify({ role: 'user', time: { created: 1_000 } }));
      insert.run('answer', 'session', 1_100, JSON.stringify({
        role: 'assistant', parentID: 'user', finish: 'stop',
        time: { created: 1_100, completed: 3_500 }, tokens: { output: 100, reasoning: 25 },
      }));
    } else {
      db.exec(`CREATE TABLE session_v2(name TEXT);
        CREATE TABLE session_message(id TEXT, session_id TEXT, type TEXT, time_created INTEGER, seq INTEGER, data TEXT);`);
      const insert = db.prepare('INSERT INTO session_message VALUES(?, ?, ?, ?, ?, ?)');
      insert.run('user', 'session', 'user', 1_000, 1, JSON.stringify({ time: { created: 1_000 } }));
      insert.run('tool-call', 'session', 'assistant', 1_100, 2, JSON.stringify({
        finish: 'tool-calls', time: { created: 1_100, completed: 2_000 },
        tokens: { output: 50, reasoning: 5 },
      }));
      insert.run('answer', 'session', 'assistant', 2_100, 3, JSON.stringify({
        finish: 'stop', time: { created: 1_100, completed: 3_500 },
        tokens: { output: 50, reasoning: 20 },
      }));
    }
    db.close();

    try {
      await expect(loadOpencodeTurnStats(
        'session',
        { databasePath, nativeVersion: version as 1 | 2 },
        { userMessageId: 'user', startedAt: 1_000 },
      )).resolves.toEqual({ outputTokens: 125, durationMs: 2_500 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
