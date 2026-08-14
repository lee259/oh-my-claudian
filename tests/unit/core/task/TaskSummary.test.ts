import { buildConversationReviewProjection } from '@/core/task/ConversationReviewProjection';
import {
  buildTaskSummaryDraft,
  defaultTaskSummaryPath,
  ensureTaskSummaryParentFolder,
  isSafeTaskSummaryPath,
} from '@/core/task/TaskSummary';
import type { Conversation } from '@/core/types';

function conversation(): Conversation {
  return {
    id: 'conversation-12345678',
    providerId: 'claude',
    title: 'Ship feature',
    createdAt: 1,
    lastActivityAt: 2,
    sessionId: 'session-1',
    task: { schemaVersion: 1, status: 'review', createdAt: 1, updatedAt: 2 },
    messages: [
      { id: 'user-1', role: 'user', content: 'Ship the feature', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', content: 'Implemented the feature.', timestamp: 2 },
    ],
  };
}

describe('TaskSummary', () => {
  it('builds an editable summary without provider payloads', () => {
    const value = conversation();
    const draft = buildTaskSummaryDraft(
      value,
      buildConversationReviewProjection(value),
      'Claudian Tasks/ship-feature.md',
      0,
    );

    expect(draft.path).toBe('Claudian Tasks/ship-feature.md');
    expect(draft.content).toContain('conversation: conversation-12345678');
    expect(draft.content).toContain('## Goal\nShip the feature');
    expect(draft.content).toContain('## Result\nImplemented the feature.');
  });

  it('accepts vault-relative markdown paths and rejects traversal or absolute paths', () => {
    expect(isSafeTaskSummaryPath('Tasks/result.md')).toBe(true);
    expect(isSafeTaskSummaryPath('../result.md')).toBe(false);
    expect(isSafeTaskSummaryPath('/result.md')).toBe(false);
    expect(isSafeTaskSummaryPath('Tasks/result.txt')).toBe(false);
  });

  it('creates a stable unique default path', () => {
    expect(defaultTaskSummaryPath(conversation())).toBe('Claudian Tasks/ship-feature-conversa.md');
  });

  it('creates missing parent folders before saving a summary', async () => {
    const folders = new Set<string>();
    const vault = {
      getAbstractFileByPath: jest.fn((path: string) => (
        folders.has(path) ? { kind: 'folder' } : null
      )),
      createFolder: jest.fn(async (path: string) => {
        folders.add(path);
        return { kind: 'folder' };
      }),
    };

    await ensureTaskSummaryParentFolder(
      vault,
      'Claudian Tasks/2026/summary.md',
      file => (file as { kind?: string }).kind === 'folder',
    );

    expect(vault.createFolder).toHaveBeenCalledWith('Claudian Tasks');
    expect(vault.createFolder).toHaveBeenCalledWith('Claudian Tasks/2026');
  });

  it('includes worker results and failures in the editable summary', () => {
    const value = conversation();
    value.task!.orchestratorPlan = {
      schemaVersion: 1,
      id: 'plan-1',
      rootConversationId: value.id,
      goal: 'Ship the feature',
      approvalStatus: 'approved',
      executionPolicy: { maxConcurrentWorkers: 1, stopOnFailure: true },
      status: 'failed',
      createdAt: 1,
      updatedAt: 2,
      subtasks: [{
        id: 'research',
        title: 'Research',
        description: 'Research',
        status: 'failed',
        dependsOn: [],
        createdAt: 1,
        updatedAt: 2,
        error: 'Worker timed out',
      }],
    };

    const draft = buildTaskSummaryDraft(value, buildConversationReviewProjection(value), 'result.md', 0);
    expect(draft.content).toContain('## Worker results');
    expect(draft.content).toContain('Worker timed out');
  });
});
