import { buildConversationReviewProjection } from '@/core/task/ConversationReviewProjection';
import type { Conversation, ToolCallInfo } from '@/core/types';

function createConversation(toolCalls: ToolCallInfo[] = []): Conversation {
  return {
    id: 'conversation-1',
    providerId: 'claude',
    title: 'Review task',
    createdAt: 1,
    lastActivityAt: 1,
    sessionId: 'session-1',
    task: {
      schemaVersion: 1,
      status: 'review',
      createdAt: 1,
      updatedAt: 2,
    },
    currentNote: 'Notes/Brief.md',
    messages: [{
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 2,
      toolCalls,
    }],
  };
}

function toolCall(overrides: Partial<ToolCallInfo>): ToolCallInfo {
  return {
    id: 'tool-1',
    name: 'Read',
    input: {},
    status: 'completed',
    ...overrides,
  };
}

describe('buildConversationReviewProjection', () => {
  it('projects task identity, linked note, and the latest native plan', () => {
    const conversation = createConversation([
      toolCall({ id: 'plan-1', name: 'ExitPlanMode', input: { planContent: 'Old plan' } }),
      toolCall({ id: 'plan-2', name: 'ExitPlanMode', input: { planContent: 'Latest plan' } }),
    ]);

    expect(buildConversationReviewProjection(conversation)).toMatchObject({
      conversationId: 'conversation-1',
      title: 'Review task',
      currentNote: 'Notes/Brief.md',
      task: conversation.task,
      latestPlan: 'Latest plan',
    });
  });

  it('projects the first accepted goal and latest assistant result', () => {
    const conversation = createConversation();
    conversation.messages.unshift({
      id: 'user-1',
      role: 'user',
      content: 'Ship the feature',
      timestamp: 1,
    });
    conversation.messages.push({
      id: 'assistant-2',
      role: 'assistant',
      content: 'Feature shipped.',
      timestamp: 3,
    });

    expect(buildConversationReviewProjection(conversation)).toMatchObject({
      goal: 'Ship the feature',
      latestAssistantResult: 'Feature shipped.',
    });
  });

  it('deduplicates changed files, aggregates normalized diff stats, and includes nested tool events', () => {
    const conversation = createConversation([
      toolCall({
        id: 'edit-1',
        name: 'Edit',
        diffData: {
          filePath: 'Notes/Brief.md',
          diffLines: [],
          stats: { added: 2, removed: 1 },
        },
      }),
      toolCall({
        id: 'agent-1',
        name: 'Agent',
        subagent: {
          id: 'agent-1',
          description: 'Review references',
          isExpanded: false,
          status: 'completed',
          toolCalls: [toolCall({
            id: 'write-1',
            name: 'Write',
            diffData: {
              filePath: 'Notes\\Brief.md',
              diffLines: [],
              stats: { added: 3, removed: 0 },
            },
          })],
        },
      }),
    ]);

    expect(buildConversationReviewProjection(conversation).changedFiles).toEqual([{
      path: 'Notes/Brief.md',
      added: 5,
      removed: 1,
      toolIds: ['edit-1', 'write-1'],
    }]);
  });

  it('reports only unresolved normalized interactions', () => {
    const conversation = createConversation([
      toolCall({
        id: 'question-pending',
        name: 'AskUserQuestion',
        input: { questions: [{ question: 'Which folder?' }] },
        status: 'running',
      }),
      toolCall({
        id: 'question-answered',
        name: 'AskUserQuestion',
        input: { questions: [{ question: 'Which model?' }] },
        status: 'completed',
        resolvedAnswers: { 'Which model?': 'fast' },
      }),
      toolCall({
        id: 'blocked-write',
        name: 'Write',
        input: { file_path: 'Notes/Brief.md' },
        status: 'blocked',
      }),
    ]);

    expect(buildConversationReviewProjection(conversation).unresolvedInteractions).toEqual([
      { toolId: 'question-pending', kind: 'question' },
      { toolId: 'blocked-write', kind: 'blocked-tool' },
    ]);
  });

  it('does not infer plans, files, or interactions from provider payloads', () => {
    const conversation = createConversation([
      toolCall({
        id: 'provider-only',
        name: 'Read',
        providerPayload: {
          rawInput: {
            planContent: 'hidden plan',
            filePath: 'hidden.md',
          },
        },
        status: 'completed',
      }),
    ]);

    expect(buildConversationReviewProjection(conversation)).toMatchObject({
      latestPlan: null,
      changedFiles: [],
      unresolvedInteractions: [],
    });
  });
});
