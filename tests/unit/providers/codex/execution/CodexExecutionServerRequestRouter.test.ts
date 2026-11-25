import type { ApprovalDecision } from '@/core/types';
import { CodexExecutionServerRequestRouter } from '@/providers/codex/execution/CodexExecutionServerRequestRouter';

function permissionsRouter(supportsStrictReview: boolean, decision: ApprovalDecision) {
  const requestApproval = jest.fn(async (request: { interactionId: string }) => ({
    decision, interactionId: request.interactionId,
  }));
  const router = new CodexExecutionServerRequestRouter('instance', {
    askUserQuestion: jest.fn(),
    dismissInteraction: jest.fn(),
    requestApproval,
    requestPlanDecision: jest.fn(),
  }, () => true, () => supportsStrictReview);
  router.setActiveTurn({
    localTurnId: 'local', nativeThreadId: 'thread', nativeTurnId: 'turn',
    toolPolicy: { kind: 'provider-default' },
  });
  return { requestApproval, router };
}

function permissionsRequest() {
  return {
    itemId: 'permissions',
    permissions: { network: { enabled: true } },
    reason: 'Need network access',
    threadId: 'thread',
    turnId: 'turn',
  };
}

describe('permissions approval', () => {
  it('offers strict auto-review and returns the grant when the CLI supports it', async () => {
    const { requestApproval, router } = permissionsRouter(true, { type: 'select-option', value: 'allow-strict-turn' });

    const reply = await router.handleServerRequest('request', 'item/permissions/requestApproval', permissionsRequest());

    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect((requestApproval.mock.calls[0][0] as unknown as { decisionOptions?: Array<{ value: string }> }).decisionOptions?.map(option => option.value))
      .toEqual(['allow-turn', 'allow-strict-turn', 'allow-session', 'deny']);
    expect(reply).toEqual({
      permissions: { network: { enabled: true } },
      scope: 'turn',
      strictAutoReview: true,
    });
  });

  it('keeps the default choices for a plain allow when the CLI has no review grants', async () => {
    const { requestApproval, router } = permissionsRouter(false, 'allow');

    const reply = await router.handleServerRequest('request', 'item/permissions/requestApproval', permissionsRequest());

    expect((requestApproval.mock.calls[0][0] as unknown as { decisionOptions?: unknown }).decisionOptions).toBeUndefined();
    expect(reply).toEqual({ permissions: { network: { enabled: true } }, scope: 'turn' });
  });

  it('grants the session when a strict prompt chooses allow-always', async () => {
    const { router } = permissionsRouter(true, 'allow-always');

    const reply = await router.handleServerRequest('request', 'item/permissions/requestApproval', permissionsRequest());

    expect(reply).toEqual({ permissions: { network: { enabled: true } }, scope: 'session' });
  });
});

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
