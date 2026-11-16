import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseAntigravityTranscript } from '@/providers/antigravity/history/AntigravityHistoryStore';
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
});
