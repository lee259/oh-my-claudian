import type * as fsType from 'fs';
import type * as osType from 'os';
import type * as pathType from 'path';

const fs = jest.requireActual<typeof fsType>('fs');
const os = jest.requireActual<typeof osType>('os');
const path = jest.requireActual<typeof pathType>('path');

import { loadSubagentConversation } from '@/providers/claude/history/ClaudeHistoryStore';

const VAULT_PATH = '/Users/test/vault';

function writeAgentSidecar(
  tempConfigDir: string,
  sessionId: string,
  agentId: string,
  lines: string[],
): void {
  const encodedVault = VAULT_PATH.replace(/[^a-zA-Z0-9]/g, '-');
  const subagentsDir = path.join(
    tempConfigDir,
    'projects',
    encodedVault,
    sessionId,
    'subagents',
  );
  fs.mkdirSync(subagentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(subagentsDir, `agent-${agentId}.jsonl`),
    lines.join('\n'),
    'utf-8',
  );
}

function pathContext(tempConfigDir: string) {
  return {
    environment: { CLAUDE_CONFIG_DIR: tempConfigDir },
    vaultPath: VAULT_PATH,
  };
}

describe('loadSubagentConversation', () => {
  let tempConfigDir: string;

  beforeEach(() => {
    tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-subagent-conv-'));
  });

  afterEach(() => {
    fs.rmSync(tempConfigDir, { recursive: true, force: true });
  });

  it('replays a full subagent transcript as chat messages', async () => {
    writeAgentSidecar(
      tempConfigDir,
      'session-1',
      'agent-1',
      [
        JSON.stringify({
          type: 'user',
          uuid: 'user-1',
          parentUuid: null,
          timestamp: '2024-01-15T10:00:00Z',
          message: { content: 'Summarize the repository layout.' },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'asst-1',
          parentUuid: 'user-1',
          timestamp: '2024-01-15T10:00:01Z',
          message: {
            model: 'claude-sonnet-4-5',
            content: [
              { type: 'text', text: 'Let me inspect the tree.' },
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'Bash',
                input: { command: 'ls' },
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          uuid: 'user-2',
          parentUuid: 'asst-1',
          timestamp: '2024-01-15T10:00:02Z',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool-1',
                content: 'src/\nREADME.md',
                is_error: false,
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'asst-2',
          parentUuid: 'user-2',
          timestamp: '2024-01-15T10:00:03Z',
          message: {
            model: 'claude-sonnet-4-5',
            content: [{ type: 'text', text: 'The repo has src/ and README.md.' }],
          },
        }),
      ],
    );

    const messages = await loadSubagentConversation(
      VAULT_PATH,
      'session-1',
      'agent-1',
      undefined,
      pathContext(tempConfigDir) as any,
    );

    expect(messages).not.toBeNull();
    const prompt = messages!.find(m => m.role === 'user' && m.content.includes('Summarize'));
    expect(prompt).toBeDefined();

    const assistantText = messages!
      .filter(m => m.role === 'assistant')
      .map(m => m.content)
      .join('\n');
    expect(assistantText).toContain('The repo has src/ and README.md.');

    const toolCallMessage = messages!
      .find(m => m.role === 'assistant' && m.toolCalls?.some(tc => tc.id === 'tool-1'));
    expect(toolCallMessage).toBeDefined();
    expect(toolCallMessage!.toolCalls![0]).toEqual(
      expect.objectContaining({
        id: 'tool-1',
        name: 'Bash',
        status: 'completed',
        result: 'src/\nREADME.md',
      }),
    );
  });

  it('returns null when the agent sidecar does not exist', async () => {
    const messages = await loadSubagentConversation(
      VAULT_PATH,
      'session-missing',
      'agent-missing',
      undefined,
      pathContext(tempConfigDir) as any,
    );

    expect(messages).toBeNull();
  });

  it('returns null for invalid agent ids', async () => {
    const messages = await loadSubagentConversation(
      VAULT_PATH,
      'session-1',
      '../bad-agent',
      undefined,
      pathContext(tempConfigDir) as any,
    );

    expect(messages).toBeNull();
  });
});
