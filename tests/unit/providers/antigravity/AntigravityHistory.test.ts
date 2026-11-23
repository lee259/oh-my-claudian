import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  hasAntigravityOutstandingSubagents,
  parseAntigravityTranscript,
  readAntigravityLatestRequest,
} from '@/providers/antigravity/history/AntigravityHistoryStore';
import { readAntigravitySessionModels } from '@/providers/antigravity/models';
import { getAntigravityProviderSettings } from '@/providers/antigravity/settings';

function readJsonFixture<T>(name: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/providers/antigravity', name), 'utf8'),
  ) as T;
}

describe('Antigravity history and models', () => {
  it('reads model and thinking choices from a session snapshot', () => {
    const configOptions = readJsonFixture<unknown[]>('runtime/session-config-options.json');
    const sessionModels = readJsonFixture<unknown>('runtime/session-models.json');

    const result = readAntigravitySessionModels(
      configOptions as never,
      sessionModels as never,
    );

    expect(result.currentModelId).toBe('gemini-4-argon');
    expect(result.models.map(model => model.rawId)).toEqual([
      'gemini-4-argon',
      'gemini-3.8-flash',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'gpt-oss-120b-medium',
    ]);
    expect(result.models[0]?.reasoningEfforts.map(effort => effort.value)).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  it('rebuilds user, assistant, tool, and task messages from a transcript', () => {
    const lines = fs.readFileSync(
      path.join(process.cwd(), 'tests/fixtures/providers/antigravity/history/transcript_full.jsonl'),
      'utf8',
    ).trim().split(/\r?\n/);
    const steps = lines.map(line => JSON.parse(line) as Record<string, unknown>);

    const messages = parseAntigravityTranscript(steps, 'session-fixture');
    const tools = messages.flatMap(message => message.toolCalls ?? []);
    const names = new Set(tools.map(tool => tool.name));

    expect(messages[0]).toMatchObject({
      content: 'Uppercase alpha and beta in notes.md.',
      role: 'user',
    });
    expect(names.has('Read')).toBe(true);
    expect(names.has('Edit')).toBe(true);
    expect(names.has('Bash')).toBe(true);
    expect(names.has('ManageTasks')).toBe(true);
    expect(names.has('GenerateImage')).toBe(true);
    expect(messages.some(message => (message.contentBlocks ?? []).some(block => block.type === 'task_notification'))).toBe(true);
  });

  it('has stable defaults when reading settings', () => {
    expect(getAntigravityProviderSettings({}).visibleModels).toBeNull();
  });

  it('finds the latest user request in the transcript', () => {
    expect(readAntigravityLatestRequest({
      argumentsEncoded: false,
      steps: [
        { step_index: 3, type: 'PLANNER_RESPONSE' },
        { step_index: 4, type: 'USER_INPUT' },
        { step_index: 5, type: 'SYSTEM_MESSAGE' },
      ],
    })).toBe(4);
  });

  it('stops waiting for a subagent only when its native record is killed', async () => {
    const storeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'antigravity-history-'));
    const records = path.join(storeRoot, 'brain', 'session-1', '.system_generated', 'subagents');
    await fsp.mkdir(records, { recursive: true });
    const transcript = {
      argumentsEncoded: false,
      steps: ['sub-1', 'sub-2'].map(id => ({
        content: `Created the following subagent:\n${JSON.stringify({ conversationId: id })}`,
        type: 'GENERIC',
      })),
    };

    try {
      await fsp.writeFile(
        path.join(records, 'sub-1.json'),
        JSON.stringify({ conversationId: 'sub-1', state: 'SUBAGENT_STATE_KILLED' }),
      );
      await fsp.writeFile(
        path.join(records, 'sub-2.json'),
        JSON.stringify({ conversationId: 'sub-2', state: 'SUBAGENT_STATE_RUNNING' }),
      );
      await expect(hasAntigravityOutstandingSubagents(transcript, 0, storeRoot, 'session-1'))
        .resolves.toBe(true);

      await fsp.writeFile(
        path.join(records, 'sub-2.json'),
        JSON.stringify({ conversationId: 'sub-2', state: 'SUBAGENT_STATE_KILLED' }),
      );
      await expect(hasAntigravityOutstandingSubagents(transcript, 0, storeRoot, 'session-1'))
        .resolves.toBe(false);
    } finally {
      await fsp.rm(storeRoot, { force: true, recursive: true });
    }
  });
});
