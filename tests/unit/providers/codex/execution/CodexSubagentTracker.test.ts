import type { SubagentInfo } from '@/core/types';
import { CodexSubagentTracker } from '@/providers/codex/execution/CodexSubagentTracker';
import type { SubAgentActivityItem, Thread } from '@/providers/codex/runtime/codexAppServerTypes';

const started: SubAgentActivityItem = { type: 'subAgentActivity', id: 'spawn', kind: 'started', agentThreadId: 'child', agentPath: '/root/helper' };
const child = (text: string): Thread => ({
  id: 'child', agentNickname: 'Bohr', model: 'model', reasoningEffort: 'high',
  turns: [{ id: 'child-turn', status: 'completed', error: null, items: [
    { type: 'agentMessage', id: 'answer', phase: 'final_answer', text, memoryCitation: null },
  ] }],
} as unknown as Thread);
it.each(['completion', 'hydration'] as const)('retains a phase-less final child report from native %s', async source => {
  const updates: SubagentInfo[] = [];
  const turn = { ...child('').turns[0], items: [
    { type: 'agentMessage', id: 'progress', phase: null, text: 'Inspecting the files.', memoryCitation: null },
    { type: 'commandExecution', id: 'cmd', command: 'echo ready', status: 'completed', aggregatedOutput: 'ready', exitCode: 0 },
    { type: 'agentMessage', id: 'answer', phase: null, text: 'The requested report.', memoryCitation: null },
  ] } as Thread['turns'][number];
  const read = source === 'hydration' ? async () => ({ ...child(''), turns: [turn] }) : () => new Promise<Thread>(() => undefined);
  const tracker = new CodexSubagentTracker(info => updates.push(info), read);
  tracker.activity(started, 'parent');
  tracker.turnStarted('child', turn.id);
  if (source === 'completion') tracker.turnCompleted('child', turn);
  else {
    tracker.activity({ ...started, id: 'completed', kind: 'completed' }, 'parent');
    await Promise.resolve();
  }
  expect(updates.at(-1)).toMatchObject({ status: 'completed', result: 'The requested report.' });
  expect(updates.at(-1)?.toolCalls).toEqual([expect.objectContaining({ id: 'cmd', status: 'completed' })]);
  expect(tracker.hasBackgroundWork()).toBe(false);
});

it.each([
  ['commentary', 'completed', 'commentary', 'completed', undefined],
  ['still running', 'inProgress', null, 'running', undefined],
  ['failed', 'failed', null, 'error', 'Native failure.'],
] as const)('does not treat %s as a completed phase-less report', (_label, status, phase, expectedStatus, expectedResult) => {
  const updates: SubagentInfo[] = [];
  const tracker = new CodexSubagentTracker(info => updates.push(info), () => new Promise(() => undefined));
  tracker.activity(started, 'parent');
  tracker.turnStarted('child', 'child-turn');
  tracker.turnCompleted('child', { ...child('Partial prose.').turns[0], status,
    error: status === 'failed' ? { message: 'Native failure.', codexErrorInfo: 'other', additionalDetails: null } : null,
    items: [{ ...child('Partial prose.').turns[0].items[0], phase }],
  } as Thread['turns'][number]);
  expect(updates.at(-1)).toMatchObject({ status: expectedStatus });
  expect(updates.at(-1)?.result).toBe(expectedResult);
});
