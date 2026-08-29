import type { ChatMessage } from '@/core/types';
import { TurnCompletionCoordinator } from '@/features/chat/controllers/TurnCompletionCoordinator';
import { ChatState } from '@/features/chat/state/ChatState';

function createFixture() {
  const state = new ChatState();
  const deps = {
    state,
    requestPlanApproval: jest.fn().mockResolvedValue({ decision: null, invalidated: false }),
    restorePrePlanPermissionModeIfNeeded: jest.fn(),
    saveConversation: jest.fn().mockResolvedValue(undefined),
    refreshActionButtons: jest.fn(),
    setComposerText: jest.fn(),
    scheduleCurrentControllerContinuation: jest.fn(),
    startNewConversation: jest.fn().mockResolvedValue(undefined),
    handleNewSessionPlan: jest.fn().mockResolvedValue(false),
    processQueuedMessage: jest.fn().mockReturnValue(false),
  };
  return { coordinator: new TurnCompletionCoordinator(deps), deps, state };
}

const userMessage: ChatMessage = {
  id: 'user-1',
  role: 'user',
  content: 'Make a plan',
  timestamp: 1,
};

describe('TurnCompletionCoordinator', () => {
  it('saves before scheduling the approved plan implementation', async () => {
    const { coordinator, deps, state } = createFixture();
    state.bumpStreamGeneration();
    state.bumpStreamGeneration();
    state.bumpStreamGeneration();
    deps.requestPlanApproval.mockResolvedValue({ decision: { type: 'implement' }, invalidated: false });

    const result = await coordinator.complete({
      streamGeneration: 3,
      didEnqueueToSdk: true,
      planCompleted: true,
      didCancelThisTurn: false,
      userMessage,
      reviewableSettlementReporter: null,
    });

    expect(deps.restorePrePlanPermissionModeIfNeeded).toHaveBeenCalledTimes(1);
    expect(deps.saveConversation).toHaveBeenCalledWith(true);
    expect(deps.refreshActionButtons).toHaveBeenCalledWith(userMessage);
    expect(deps.scheduleCurrentControllerContinuation).toHaveBeenCalledWith('Implement the plan.', null);
    expect(deps.processQueuedMessage).not.toHaveBeenCalled();
    expect(result).toEqual({
      planApprovalInvalidated: false,
      scheduledContinuation: true,
      continuationStaysInCurrentController: true,
    });
  });

  it('keeps revision feedback in the composer without consuming queued input', async () => {
    const { coordinator, deps, state } = createFixture();
    state.bumpStreamGeneration();
    state.bumpStreamGeneration();
    deps.requestPlanApproval.mockResolvedValue({
      decision: { type: 'revise', text: 'Add deployment constraints.' },
      invalidated: false,
    });

    const result = await coordinator.complete({
      streamGeneration: 2,
      didEnqueueToSdk: true,
      planCompleted: true,
      didCancelThisTurn: false,
      userMessage,
      reviewableSettlementReporter: null,
    });

    expect(deps.setComposerText).toHaveBeenCalledWith('Add deployment constraints.');
    expect(deps.processQueuedMessage).not.toHaveBeenCalled();
    expect(result.scheduledContinuation).toBe(false);
  });

  it('does not persist or schedule stale plan approval results', async () => {
    const { coordinator, deps, state } = createFixture();
    for (let generation = 0; generation < 5; generation++) state.bumpStreamGeneration();
    deps.requestPlanApproval.mockResolvedValue({ decision: { type: 'implement' }, invalidated: true });

    const result = await coordinator.complete({
      streamGeneration: 5,
      didEnqueueToSdk: true,
      planCompleted: true,
      didCancelThisTurn: false,
      userMessage,
      reviewableSettlementReporter: null,
    });

    expect(deps.saveConversation).not.toHaveBeenCalled();
    expect(deps.scheduleCurrentControllerContinuation).not.toHaveBeenCalled();
    expect(result.planApprovalInvalidated).toBe(true);
  });
});
