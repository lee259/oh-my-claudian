import type { ProviderApprovalInteractionRequest } from '@/core/execution/ProviderInteractionPort';
import { ChatState } from '@/features/chat/state/ChatState';
import type { AsyncQuestionInteractionRequest, ChatInteractionPresentation } from '@/features/chat/state/PendingChatInteractions';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const approval = {
  kind: 'approval' as const, interactionId: 'approval-1', sessionInstanceId: 'session-1', turnId: 'turn-1',
  toolName: 'Bash', input: { command: 'ls' }, description: 'List notes',
};

it('retains a request across presentation replacement and ignores late answers from the previous widget', async () => {
  const state = new ChatState();
  const old = deferred<{ interactionId: string; decision: 'allow' }>();
  const dismiss = jest.fn();
  let signal!: AbortSignal;
  const detach = state.interactions.attachPresentation({
    requestApproval: (_request: ProviderApprovalInteractionRequest, presentationSignal: AbortSignal) => { signal = presentationSignal; return old.promise; },
    dismissInteraction: dismiss,
  } as unknown as ChatInteractionPresentation);
  const result = state.interactions.requestApproval(approval, new AbortController().signal);
  detach();
  expect(signal.aborted).toBe(true);
  expect(state.requiresAction).toBe(true);
  expect(state.interactions.pending).toEqual([approval]);
  old.resolve({ interactionId: 'approval-1', decision: 'allow' });
  await Promise.resolve();
  expect(state.interactions.pending).toEqual([approval]);
  const current = deferred<{ interactionId: string; decision: 'deny' }>();
  state.interactions.attachPresentation({ requestApproval: () => current.promise, dismissInteraction: jest.fn() } as unknown as ChatInteractionPresentation);
  detach(); // The old owner's cleanup must not detach its replacement.
  current.resolve({ interactionId: 'approval-1', decision: 'deny' });
  await expect(result).resolves.toEqual({ interactionId: 'approval-1', decision: 'deny' });
  expect(state.requiresAction).toBe(false);
});

it('queues different interaction kinds and dismisses only the specified request', async () => {
  const state = new ChatState();
  const answer = deferred<{ interactionId: string; answers: { Note: string } }>();
  const requestApproval = jest.fn();
  const askUserQuestion = jest.fn(() => answer.promise);
  const requestPlanDecision = jest.fn(async () => ({ interactionId: 'plan-1', decision: { type: 'feedback' as const, text: 'Keep scope narrow' } }));
  state.interactions.attachPresentation({ requestApproval, askUserQuestion, requestPlanDecision, dismissInteraction: jest.fn(), requestLocalPlanApproval: jest.fn(), requestAsyncQuestion: jest.fn() });
  const question = state.interactions.askUserQuestion({ kind: 'question', interactionId: 'question-1', sessionInstanceId: 'session-1', turnId: 'background-1', input: { questions: [{ question: 'Note?' }] } }, new AbortController().signal);
  const cancelled = state.interactions.requestApproval(approval, new AbortController().signal);
  const plan = state.interactions.requestPlanDecision({ kind: 'plan-decision', interactionId: 'plan-1', sessionInstanceId: 'session-1', turnId: 'turn-1', input: { plan: 'Refactor' }, presentation: { allowNewSession: true } }, new AbortController().signal);
  expect(requestApproval).not.toHaveBeenCalled();
  expect(requestPlanDecision).not.toHaveBeenCalled();
  state.interactions.dismissInteraction('approval-1', 'native-rejected');
  await expect(cancelled).resolves.toEqual({ interactionId: 'approval-1', decision: 'cancel' });
  expect(state.requiresAction).toBe(true);
  answer.resolve({ interactionId: 'question-1', answers: { Note: 'Daily' } });
  await expect(question).resolves.toEqual({ interactionId: 'question-1', answers: { Note: 'Daily' } });
  await expect(plan).resolves.toEqual({ interactionId: 'plan-1', decision: { type: 'feedback', text: 'Keep scope narrow' } });
  expect(state.requiresAction).toBe(false);
});

it.each(['approval', 'question', 'plan-decision'] as const)('settles %s without presentation on abort and rejects reuse of an in-flight ID', async kind => {
  const state = new ChatState();
  const controller = new AbortController();
  let result: Promise<unknown>;
  if (kind === 'approval') {
    result = state.interactions.requestApproval(approval, controller.signal);
  } else if (kind === 'question') result = state.interactions.askUserQuestion({ ...approval, kind }, controller.signal);
  else result = state.interactions.requestPlanDecision({ ...approval, kind }, controller.signal);
  controller.abort();
  await expect(result).resolves.toEqual(kind === 'question'
    ? { interactionId: 'approval-1', answers: null }
    : { interactionId: 'approval-1', decision: kind === 'approval' ? 'cancel' : null });
  expect(state.interactions.pending).toEqual([]);
  expect(state.requiresAction).toBe(false);
});

it('rejects a mismatched response and ends pending attention after a rendering failure', async () => {
  const state = new ChatState();
  state.interactions.attachPresentation({ requestApproval: async () => ({ interactionId: 'wrong', decision: 'allow' }), dismissInteraction: jest.fn() } as unknown as ChatInteractionPresentation);
  await expect(state.interactions.requestApproval(approval, new AbortController().signal)).rejects.toThrow('identity');
  state.interactions.attachPresentation({ requestApproval: () => { throw new Error('Render failed'); }, dismissInteraction: jest.fn() } as unknown as ChatInteractionPresentation);
  await expect(state.interactions.requestApproval(approval, new AbortController().signal)).rejects.toThrow('Render failed');
  expect(state.requiresAction).toBe(false);
});

it('invalidates headless interactions when the conversation is replaced', async () => {
  const state = new ChatState();
  const result = state.interactions.requestApproval(approval, new AbortController().signal);
  state.resetForNewConversation();
  await expect(result).resolves.toEqual({ interactionId: 'approval-1', decision: 'cancel' });
  expect(state.interactions.pending).toEqual([]);
});

it('retains local plan confirmation across detach and marks execution cancellation as invalidation', async () => {
  const state = new ChatState();
  const result = state.interactions.requestLocalPlanApproval({ kind: 'local-plan', interactionId: 'local-1' }, new AbortController().signal);
  expect(state.requiresAction).toBe(true);
  state.interactions.dismissAll('cancelled');
  await expect(result).resolves.toEqual({ interactionId: 'local-1', decision: null, invalidated: true });
});

it('retains successful async answer delivery even when its widget detaches while sending', async () => {
  const state = new ChatState();
  const delivered = deferred<void>();
  const send = jest.fn(() => delivered.promise);
  let submit!: (answers: { Note: string }) => Promise<void>;
  const detach = state.interactions.attachPresentation({
    requestAsyncQuestion: (request: AsyncQuestionInteractionRequest) => { submit = request.onSubmit; return new Promise(() => undefined); },
    dismissInteraction: jest.fn(),
  } as unknown as ChatInteractionPresentation);
  let settled = false;
  const result = state.interactions.requestAsyncQuestion({ kind: 'async-question', interactionId: 'ask-1', input: {}, onSubmit: send }, new AbortController().signal);
  void result.then(() => { settled = true; });
  const delivery = submit({ Note: 'Daily' });
  await expect(submit({ Note: 'Other' })).rejects.toThrow('already being sent');
  detach();
  await expect(submit({ Note: 'Other' })).rejects.toThrow('no longer active');
  delivered.resolve();
  await delivery;
  await Promise.resolve();
  expect(settled).toBe(true);
  await expect(result).resolves.toEqual({ interactionId: 'ask-1', answers: { Note: 'Daily' } });
  expect(send).toHaveBeenCalledTimes(1);
  expect(state.interactions.pending).toEqual([]);
});

it('rejects a duplicate live request ID', async () => {
  const state = new ChatState();
  const result = state.interactions.requestApproval(approval, new AbortController().signal);
  await expect(state.interactions.requestApproval(approval, new AbortController().signal)).rejects.toThrow('Duplicate');
  state.interactions.dismissAll('cancelled');
  await result;
});

it('ends queued async questions on disposal without requiring an input controller', async () => {
  const state = new ChatState();
  const tracker = state.bindAsyncQuestionPrompts({
    getConversationId: () => 'conversation-1',
    answer: async () => undefined,
    onChange: () => undefined,
    onPendingChange: (id, pending) => pending ? state.beginActionRequired(id) : state.endActionRequired(id),
    showQuestion: (tool, signal, onSubmit) => state.interactions.requestAsyncQuestion({ kind: 'async-question', interactionId: `prompt:${tool.id}`, input: tool.input, onSubmit }, signal).then(response => response.answers),
  });
  const tools = ['one', 'two'].map(id => ({ id, name: 'AskUserQuestion', status: 'completed' as const,
    input: { replyMode: 'user-message', questions: [{ question: 'Note?' }] }, questionStatus: undefined as 'pending' | 'expired' | undefined }));
  tools.forEach(tool => tracker.update(tool));
  state.dismissInteractions('session-disposed');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(tools.map(tool => tool.questionStatus)).toEqual(['expired', 'expired']);
  expect(state.interactions.pending).toEqual([]);
  expect(state.requiresAction).toBe(false);
});
