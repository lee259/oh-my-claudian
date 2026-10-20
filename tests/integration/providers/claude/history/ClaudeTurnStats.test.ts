import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { getSDKSessionPath, loadSDKSessionMessages } from '@/providers/claude/history/ClaudeHistoryStore';
import { loadClaudeTurnStats } from '@/providers/claude/history/ClaudeTurnStats';

it.each([[1, false], [2, false], [1, true]] as const)(
  'replays %i folded prompts after their consumed parent (progress: %s), with matching live timing',
  async (count, progress) => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-folded-prompts-'));
    const vault = path.resolve('/audit-vault');
    const context = { environment: { CLAUDE_CONFIG_DIR: home } };
    const file = getSDKSessionPath(vault, 'session', context);
    const time = (seconds: number) => new Date(Date.UTC(2026, 9, 20) + seconds * 1000).toISOString();
    const entries = [
      { type: 'user', uuid: 'u', timestamp: time(0), message: { content: 'Work' } },
      { type: 'assistant', uuid: 'a1', parentUuid: 'u', timestamp: time(1),
        message: { id: 'r1', stop_reason: 'tool_use', usage: { output_tokens: 100 },
          content: [{ type: 'tool_use', id: 'bash', name: 'Bash', input: {} }] } },
      { type: 'user', uuid: 'tool', parentUuid: 'a1', timestamp: time(10), toolUseResult: {},
        message: { content: [{ type: 'tool_result', tool_use_id: 'bash', content: 'done' }] } },
      ...(progress ? [{ type: 'progress', uuid: 'progress', parentUuid: 'tool', timestamp: time(11) }] : []),
      ...Array.from({ length: count }, (_, i) => ({
        type: 'attachment', uuid: `fold-${i}`, parentUuid: i ? `fold-${i - 1}` : progress ? 'progress' : 'tool',
        timestamp: time(2 + i),
        attachment: { type: 'queued_command', prompt: `Steer ${i}`, source_uuid: `input-${i}`, commandMode: 'prompt' },
      })),
      { type: 'assistant', uuid: 'final', parentUuid: `fold-${count - 1}`, timestamp: time(13),
        message: { id: 'r2', stop_reason: 'end_turn', usage: { output_tokens: 25 }, content: [{ type: 'text', text: 'Done' }] } },
    ];
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\n'));
      const stats = await loadClaudeTurnStats(vault, 'session', 'final', context);
      const replay = await loadSDKSessionMessages(vault, 'session', 'final', file, context);
      expect(replay.error).toBeUndefined();
      expect(stats).toEqual({ outputTokens: 25, durationMs: progress ? 2000 : 3000 });
      expect(replay.messages.at(-1)?.turnStats).toEqual(stats);
      expect(replay.messages.map(message => message.content || message.contentBlocks?.[0]?.type))
        .toEqual(['Work', 'tool_use', ...Array.from({ length: count }, (_, i) => `Steer ${i}`), 'Done']);
      expect(replay.messages.filter(message => message.role === 'user').map(message => message.userMessageId))
        .toEqual(['u', ...Array.from({ length: count }, (_, i) => `input-${i}`)]);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  },
);
