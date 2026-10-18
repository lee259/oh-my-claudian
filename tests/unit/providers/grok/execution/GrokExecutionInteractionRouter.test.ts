import { GrokExecutionInteractionRouter } from '@/providers/grok/execution/GrokExecutionInteractionRouter';

it.each([false, true])('keeps own Grok answer and preview keys, excluding inherited answers (%s)', async inherited => {
  const router = new GrokExecutionInteractionRouter({
    askUserQuestion: async request => ({
      interactionId: request.interactionId,
      answers: inherited ? Object.create({ ['__proto__']: 'yes' }) : JSON.parse('{"__proto__":"yes"}'),
    }),
    dismissInteraction: jest.fn(), requestApproval: jest.fn(), requestPlanDecision: jest.fn(),
  }, 'instance', () => 'turn', () => 'native');
  const reply = await router.handle('x.ai/ask_user_question', {
    mode: 'default', sessionId: 'native', toolCallId: 'question',
    questions: [{ id: '__proto__', question: '__proto__', multiSelect: false,
      options: [{ id: 'yes', label: 'Yes', preview: 'Preview' }] }],
  });
  expect(JSON.stringify(reply)).toBe(inherited ? '{"answers":{},"outcome":"accepted"}'
    : '{"annotations":{"__proto__":{"preview":"Preview"}},"answers":{"__proto__":["Yes"]},"outcome":"accepted"}');
});
