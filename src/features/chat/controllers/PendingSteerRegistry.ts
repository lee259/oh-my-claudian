import type { ChatMessage } from '../../../core/types';
import type { ChatExecutionCoordinator } from '../execution/ChatExecutionCoordinator';
import type { QueuedMessage } from '../state/types';

export interface PendingProviderUserMessage {
  displayContent: string;
  persistedContent?: string;
  currentNote?: string;
  images?: ChatMessage['images'];
}

export type PendingSteerProviderDisposition =
  | 'awaiting-result'
  | 'definitely-unsent'
  | 'accepted-awaiting-correlation'
  | 'ambiguous-awaiting-reconciliation';

export interface PendingSteerState {
  readonly conversationId: string;
  readonly coordinator: ChatExecutionCoordinator;
  readonly inputRecordId: string;
  readonly message: QueuedMessage;
  readonly expectedProviderMessage: PendingProviderUserMessage;
  providerDisposition: PendingSteerProviderDisposition;
  uiState: 'visible' | 'cleared';
  correlationState: 'pending' | 'settled' | 'delegated-to-history';
  retryState: 'blocked' | 'parked' | 'restored';
}

/** Owns pending provider correlation and its visible queue state per conversation. */
export class PendingSteerRegistry {
  private readonly pendingByConversation = new Map<string, PendingSteerState>();

  constructor(
    private readonly onUiStateChanged: (conversationId: string) => void,
  ) {}

  get(conversationId: string | null): PendingSteerState | null {
    if (!conversationId) return null;
    return this.pendingByConversation.get(conversationId) ?? null;
  }

  has(conversationId: string): boolean {
    return this.pendingByConversation.has(conversationId);
  }

  register(pending: PendingSteerState): void {
    this.pendingByConversation.set(pending.conversationId, pending);
    this.notifyUiChange(pending);
  }

  clearUi(pending: PendingSteerState): void {
    pending.uiState = 'cleared';
    this.notifyUiChange(pending);
  }

  clearCurrentUi(conversationId: string | null): void {
    const pending = this.get(conversationId);
    if (pending) this.clearUi(pending);
  }

  release(pending: PendingSteerState): void {
    if (this.pendingByConversation.get(pending.conversationId) !== pending) return;
    this.pendingByConversation.delete(pending.conversationId);
    pending.coordinator.releaseSteerCorrelation(pending.inputRecordId);
  }

  delegateToHistory(conversationId: string | null): PendingSteerState | null {
    const pending = this.get(conversationId);
    if (!pending) return null;

    if (pending.correlationState === 'pending') {
      pending.correlationState = 'delegated-to-history';
    }
    this.clearUi(pending);
    if (
      pending.providerDisposition !== 'awaiting-result'
      || pending.correlationState === 'settled'
    ) {
      this.release(pending);
    }
    return pending;
  }

  private notifyUiChange(pending: PendingSteerState): void {
    this.onUiStateChanged(pending.conversationId);
  }
}
