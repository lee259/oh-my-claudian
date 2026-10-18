import type { ToolCallInfo } from '@/core/types';
import {
  formatCodexQuestionReply,
  parseCodexQuestionReply,
  stripCodexQuestionReplies,
} from '@/providers/codex/normalization/codexQuestionNormalization';

describe('Codex async question reply normalization', () => {
  it('falls back to own question text without treating inherited keys as answers', () => {
    const tool: ToolCallInfo = {
      id: 'question-call', name: 'AskUserQuestion', status: 'completed',
      input: { replyMode: 'user-message', questions: [{ id: 'constructor', question: 'Continue?' }] },
    };
    const reply = formatCodexQuestionReply(tool, { 'Continue?': 'Yes' });
    expect(reply).not.toBeNull();
    expect(parseCodexQuestionReply(reply!.content)[0]?.answer).toBe('Yes');
    expect(formatCodexQuestionReply(tool, Object.create({ constructor: 'Inherited' }))).toBeNull();
    expect(formatCodexQuestionReply(tool, { constructor: '', 'Continue?': 'Yes' })).toBeNull();
  });

  it('formats answers with the native async question identity and hides them from the chat bubble', () => {
    const tool: ToolCallInfo = {
      id: 'question-call',
      name: 'AskUserQuestion',
      status: 'completed',
      input: {
        replyMode: 'user-message',
        questions: [{ id: '0', question: 'Which check?', header: 'Check', options: [], multiSelect: false }],
      },
    };

    const reply = formatCodexQuestionReply(tool, { '0': 'History <and> rendering' });

    expect(reply?.displayContent).toBe('');
    expect(parseCodexQuestionReply(reply!.content)).toEqual([{
      callId: 'question-call',
      index: 0,
      question: 'Which check?',
      answer: 'History <and> rendering',
    }]);
    expect(stripCodexQuestionReplies(`before\n${reply!.content}\nafter`)).toBe('before\n\nafter');
  });

  it('rejects blocking questions, empty answers, and malformed protocol payloads', () => {
    const tool: ToolCallInfo = {
      id: 'question-call',
      name: 'AskUserQuestion',
      status: 'completed',
      input: { questions: [{ question: 'Which check?' }] },
    };

    expect(formatCodexQuestionReply(tool, { 'Which check?': 'History' })).toBeNull();
    expect(formatCodexQuestionReply({ ...tool, input: { ...tool.input, replyMode: 'user-message' } }, {})).toBeNull();
    expect(parseCodexQuestionReply('<send_user_message_question_reply>not JSON</send_user_message_question_reply>')).toEqual([]);
    const malformed = '<send_user_message_question_reply>not JSON</send_user_message_question_reply>';
    expect(stripCodexQuestionReplies(malformed)).toBe(malformed);
  });
});
