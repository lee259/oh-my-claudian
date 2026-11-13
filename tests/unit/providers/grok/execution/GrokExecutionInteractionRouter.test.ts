import { setLocale } from '@/i18n/i18n';
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

it('localizes the plan approval presentation', async () => {
  setLocale('zh-CN');
  try {
    const requestPlanDecision = jest.fn(async request => ({
      decision: { type: 'approve' },
      interactionId: request.interactionId,
    }));
    const router = new GrokExecutionInteractionRouter(
      {
        askUserQuestion: jest.fn(),
        dismissInteraction: jest.fn(),
        requestApproval: jest.fn(),
        requestPlanDecision,
      } as never,
      'instance',
      () => 'turn',
      () => 'native',
    );

    await router.handle('x.ai/exit_plan_mode', {
      planContent: '# Plan',
      sessionId: 'native',
      toolCallId: 'plan-call',
    });

    expect(requestPlanDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        presentation: expect.objectContaining({
          approveLabel: '实施',
          feedbackLabel: '修改',
        }),
      }),
      expect.anything(),
    );
  } finally {
    setLocale('en');
  }
});

it('dismisses a pending question when its requesting turn aborts', async () => {
  const dismissInteraction = jest.fn();
  let questionSignal: AbortSignal | undefined;
  const askUserQuestion = jest.fn((request: { interactionId: string }, signal?: AbortSignal) => {
    questionSignal = signal;
    return new Promise(resolve => {
      signal?.addEventListener('abort', () => resolve({ interactionId: request.interactionId, answers: null }), { once: true });
    });
  });
  const router = new GrokExecutionInteractionRouter({
    askUserQuestion,
    dismissInteraction,
    requestApproval: jest.fn(),
    requestPlanDecision: jest.fn(),
  } as never, 'instance', () => 'turn', () => 'native');
  const caller = new AbortController();

  const reply = router.handle('x.ai/ask_user_question', {
    mode: 'default', sessionId: 'native', toolCallId: 'question',
    questions: [{ question: 'Which area?', multiSelect: false, options: [{ label: 'Source' }] }],
  }, caller.signal);
  await Promise.resolve();

  expect(questionSignal?.aborted).toBe(false);
  caller.abort();
  expect(questionSignal?.aborted).toBe(true);
  await expect(reply).resolves.toEqual({ outcome: 'cancelled' });
  expect(dismissInteraction).toHaveBeenCalledWith(expect.stringContaining(':question:'), 'cancelled');
});

it('reports typed answers as Other with notes', async () => {
  const router = new GrokExecutionInteractionRouter({
    askUserQuestion: async (request: { interactionId: string }) => ({ interactionId: request.interactionId, answers: { 'Which area?': 'Custom note' } }),
    dismissInteraction: jest.fn(), requestApproval: jest.fn(), requestPlanDecision: jest.fn(),
  } as never, 'instance', () => 'turn', () => 'native');
  const reply = await router.handle('x.ai/ask_user_question', {
    sessionId: 'native', toolCallId: 'question', mode: 'default',
    questions: [{ question: 'Which area?', multiSelect: false, options: [{ label: 'Source', description: '' }] }],
  });
  expect(reply).toEqual({ annotations: { 'Which area?': { notes: 'Custom note' } }, answers: { 'Which area?': ['Other'] }, outcome: 'accepted' });
});
