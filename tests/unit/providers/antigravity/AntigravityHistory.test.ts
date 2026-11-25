import * as fs from 'node:fs';
import * as path from 'node:path';

import { TOOL_SEND_MESSAGE, TOOL_WORKFLOW } from '@/core/tools/toolNames';
import {
  parseAntigravityTranscript,
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

  it('treats a background launch receipt as a completed call', () => {
    const steps = [
      { content: '<USER_REQUEST>\nRun it.\n</USER_REQUEST>', created_at: '2026-01-01T00:00:00Z', source: 'USER_EXPLICIT', status: 'DONE', step_index: 0, type: 'USER_INPUT' },
      { created_at: '2026-01-01T00:00:01Z', source: 'MODEL', status: 'DONE', step_index: 1, tool_calls: [{ args: { Description: 'Build', Script: 'print(1)' }, name: 'run_workflow' }], type: 'PLANNER_RESPONSE' },
      { content: 'Tool is running as a background task', created_at: '2026-01-01T00:00:02Z', source: 'MODEL', status: 'RUNNING', step_index: 2, type: 'GENERIC' },
      { content: 'Started the workflow.', created_at: '2026-01-01T00:00:03Z', source: 'MODEL', status: 'DONE', step_index: 3, type: 'PLANNER_RESPONSE' },
    ];

    const tool = parseAntigravityTranscript(steps as never, 'session-1')
      .flatMap(message => message.toolCalls ?? [])
      .find(candidate => candidate.name === TOOL_WORKFLOW);

    expect(tool).toMatchObject({ status: 'completed' });
  });

  it('applies the live tool-result normalization to history', () => {
    const steps = [
      { content: '<USER_REQUEST>\nTell it to go on.\n</USER_REQUEST>', created_at: '2026-01-01T00:00:00Z', source: 'USER_EXPLICIT', status: 'DONE', step_index: 0, type: 'USER_INPUT' },
      { created_at: '2026-01-01T00:00:01Z', source: 'MODEL', status: 'DONE', step_index: 1, tool_calls: [{ args: { Message: 'Go on', Target: 'sub-1' }, name: 'send_message' }], type: 'PLANNER_RESPONSE' },
      { content: 'Message sent to "sub-1".', created_at: '2026-01-01T00:00:02Z', source: 'MODEL', status: 'DONE', step_index: 2, type: 'GENERIC' },
      { content: 'Sent.', created_at: '2026-01-01T00:00:03Z', source: 'MODEL', status: 'DONE', step_index: 3, type: 'PLANNER_RESPONSE' },
    ];

    const tool = parseAntigravityTranscript(steps as never, 'session-1')
      .flatMap(message => message.toolCalls ?? [])
      .find(candidate => candidate.name === TOOL_SEND_MESSAGE);

    expect(tool).toMatchObject({ status: 'completed' });
    expect(tool?.result).toBeUndefined();
  });
});
