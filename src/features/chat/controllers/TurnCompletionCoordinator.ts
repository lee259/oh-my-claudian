import type { ChatMessage } from '../../../core/types';
import type { PlanApprovalDecision } from '../rendering/InlinePlanApproval';
import type { ChatState } from '../state/ChatState';

export interface TurnCompletionCoordinatorDeps {
  state: ChatState;
  requestPlanApproval: () => Promise<{
    decision: PlanApprovalDecision | null;
    invalidated: boolean;
  }>;
  restorePrePlanPermissionModeIfNeeded: () => void | Promise<void>;
  saveConversation: (didEnqueueToSdk: boolean) => Promise<void>;
  refreshActionButtons: (userMessage: ChatMessage) => void;
  setComposerText: (text: string) => void;
  scheduleCurrentControllerContinuation: (content: string, reporter: (() => void) | null) => void;
  startNewConversation: () => Promise<void>;
  handleNewSessionPlan: (content: string) => Promise<boolean>;
  processQueuedMessage: () => boolean;
}

export interface TurnCompletionOptions {
  streamGeneration: number;
  didEnqueueToSdk: boolean;
  planCompleted: boolean;
  didCancelThisTurn: boolean;
  userMessage: ChatMessage;
  reviewableSettlementReporter: (() => void) | null;
}

export interface TurnCompletionResult {
  planApprovalInvalidated: boolean;
  scheduledContinuation: boolean;
  continuationStaysInCurrentController: boolean;
}

/** Coordinates terminal plan decisions, persistence, and follow-up turn scheduling. */
export class TurnCompletionCoordinator {
  constructor(private readonly deps: TurnCompletionCoordinatorDeps) {}

  async complete(options: TurnCompletionOptions): Promise<TurnCompletionResult> {
    const { state } = this.deps;
    let planApprovalInvalidated = false;
    let planAutoSendContent: string | null = null;
    let shouldProcessQueuedMessage = true;

    if (options.planCompleted && !options.didCancelThisTurn) {
      const planInteractionId = `local-plan-approval:${options.streamGeneration}`;
      state.beginActionRequired(planInteractionId);
      let decisionResult: { decision: PlanApprovalDecision | null; invalidated: boolean };
      try {
        decisionResult = await this.deps.requestPlanApproval();
      } finally {
        state.endActionRequired(planInteractionId);
      }

      const { decision, invalidated } = decisionResult;
      if (state.streamGeneration !== options.streamGeneration || invalidated) {
        planApprovalInvalidated = true;
      } else if (decision?.type === 'implement') {
        await this.deps.restorePrePlanPermissionModeIfNeeded();
        planAutoSendContent = 'Implement the plan.';
      } else if (decision?.type === 'revise') {
        this.deps.setComposerText(decision.text);
        shouldProcessQueuedMessage = false;
      } else {
        await this.deps.restorePrePlanPermissionModeIfNeeded();
      }
    }

    if (planApprovalInvalidated) {
      return {
        planApprovalInvalidated,
        scheduledContinuation: false,
        continuationStaysInCurrentController: false,
      };
    }

    await this.deps.saveConversation(options.didEnqueueToSdk);
    this.deps.refreshActionButtons(options.userMessage);

    if (planAutoSendContent) {
      this.deps.scheduleCurrentControllerContinuation(
        planAutoSendContent,
        options.reviewableSettlementReporter,
      );
      return {
        planApprovalInvalidated: false,
        scheduledContinuation: true,
        continuationStaysInCurrentController: true,
      };
    }

    const planContent = state.pendingNewSessionPlan;
    if (planContent) {
      state.pendingNewSessionPlan = null;
      if (await this.deps.handleNewSessionPlan(planContent)) {
        return {
          planApprovalInvalidated: false,
          scheduledContinuation: true,
          continuationStaysInCurrentController: false,
        };
      }

      await this.deps.startNewConversation();
      this.deps.scheduleCurrentControllerContinuation(
        planContent,
        options.reviewableSettlementReporter,
      );
      return {
        planApprovalInvalidated: false,
        scheduledContinuation: true,
        continuationStaysInCurrentController: true,
      };
    }

    const scheduledContinuation = shouldProcessQueuedMessage && this.deps.processQueuedMessage();
    return {
      planApprovalInvalidated: false,
      scheduledContinuation,
      continuationStaysInCurrentController: scheduledContinuation,
    };
  }
}
