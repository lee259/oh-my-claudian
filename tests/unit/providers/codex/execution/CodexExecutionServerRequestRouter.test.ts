import { CodexExecutionServerRequestRouter } from '@/providers/codex/execution/CodexExecutionServerRequestRouter';

it('preserves an own prototype-named question key in the native Codex reply', async () => {
  const router = new CodexExecutionServerRequestRouter('instance', {
    askUserQuestion: async request => ({
      interactionId: request.interactionId, answers: JSON.parse('{"__proto__":["Yes"]}'),
    }),
    dismissInteraction: jest.fn(), requestApproval: jest.fn(), requestPlanDecision: jest.fn(),
  }, () => true);
  router.setActiveTurn({
    localTurnId: 'local', nativeThreadId: 'thread', nativeTurnId: 'turn',
    toolPolicy: { kind: 'provider-default' },
  });
  const reply = await router.handleServerRequest('request', 'item/tool/requestUserInput', {
    threadId: 'thread', turnId: 'turn', itemId: 'question', questions: [],
  });
  expect(JSON.stringify(reply)).toBe('{"answers":{"__proto__":{"answers":["Yes"]}}}');
});
