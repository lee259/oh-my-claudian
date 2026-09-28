import type { ToolCallInfo } from '@/core/types';
import { AsyncQuestionPrompts } from '@/features/chat/rendering/AsyncQuestionPrompts';

function asyncQuestion(id: string): ToolCallInfo {
  return {
    id,
    name: 'AskUserQuestion',
    input: { replyMode: 'user-message', questions: [{ id: '0', question: `Question ${id}` }] },
    status: 'completed',
  };
}

describe('AsyncQuestionPrompts', () => {
  it('queues concurrent prompts and only opens the next after the current is answered', async () => {
    const shown: Array<{
      tool: ToolCallInfo;
      resolve: (answers: Record<string, string | string[]> | null) => void;
      onSubmit: (answers: Record<string, string | string[]>) => Promise<void>;
    }> = [];
    const changes: ToolCallInfo[] = [];
    const manager = new AsyncQuestionPrompts({
      showQuestion: (tool, _signal, onSubmit) => new Promise(resolve => shown.push({ tool, resolve, onSubmit })),
      answer: async () => undefined,
      onChange: tool => changes.push(tool),
      onPendingChange: () => undefined,
      getConversationId: () => 'conversation-1',
    });

    manager.update(asyncQuestion('first'));
    manager.update(asyncQuestion('second'));
    expect(shown.map(prompt => prompt.tool.id)).toEqual(['first']);

    shown[0].resolve({ '0': 'yes' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(shown.map(prompt => prompt.tool.id)).toEqual(['first', 'second']);
    expect(changes.find(tool => tool.id === 'first')?.resolvedAnswers).toEqual({ '0': 'yes' });

    shown[1].resolve(null);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(changes.find(tool => tool.id === 'second')?.questionStatus).toBe('expired');
  });
});
