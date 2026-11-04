import { loadDeepSeekHistory } from '@/providers/deepseek/history/DeepSeekHistoryStore';

function createReader(events: Array<Record<string, unknown>>) {
  return {
    call: jest.fn(async (method: string) => method === 'session/page'
      ? { records: events.map(event => ({ type: 'event', event })), hasMore: false }
      : {}),
  };
}

function records(reason: string): Array<Record<string, unknown>> {
  return [
    { seq: 1, time: 1_000, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, time: 1_001, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] } },
    {
      seq: 3,
      time: 1_002,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 0,
        message: { content: [{ type: 'text', text: 'partial answer' }] },
        usage: {},
      },
    },
    { seq: 4, time: 1_003, type: 'turn/end', data: { reason: { kind: reason } } },
  ];
}

describe('DeepSeek failed history', () => {
  it.each(['error', 'blocked'])('keeps committed output without a completion checkpoint for %s turns', async (reason) => {
    const messages = await loadDeepSeekHistory(createReader(records(reason)) as never, 'session-1', 4);
    const assistant = messages.find(message => message.role === 'assistant');

    expect(assistant?.content).toBe('partial answer');
    expect(assistant?.assistantMessageId).toBeUndefined();
    expect(assistant?.durationSeconds).toBeUndefined();
    expect(assistant?.turnStats).toBeUndefined();
  });

  it('keeps the completion checkpoint for a successful turn', async () => {
    const messages = await loadDeepSeekHistory(createReader(records('completed')) as never, 'session-1', 4);
    const assistant = messages.find(message => message.role === 'assistant');

    expect(assistant?.assistantMessageId).toBeDefined();
    expect(assistant?.durationSeconds).toBeDefined();
  });
});
