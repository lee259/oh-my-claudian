import type { MessageRenderer } from '../rendering/MessageRenderer';

export type MessagePresentation = Pick<MessageRenderer,
  | 'appendInterruptIndicator' | 'finalizeCompletedWork' | 'finalizeTranscriptTurn'
  | 'refreshActionButtons' | 'removeMessage' | 'renderFinalMessageTimestamp'
  | 'setTranscriptExecutionScope' | 'addTextCopyButton' | 'startCompletedWork'
  | 'syncStreamingActivity' | 'refreshBranchButtonState' | 'refreshBranchButtons'
  | 'renderMessagesInto' | 'updateLiveUserMessage' | 'renderContent'
> & {
  addMessage(...args: Parameters<MessageRenderer['addMessage']>): HTMLElement | null;
  renderMessages(...args: Parameters<MessageRenderer['renderMessages']>): HTMLElement | null;
  renderCitationGroup(...args: Parameters<MessageRenderer['renderCitationGroup']>): HTMLElement | null;
  renderTaskNotification(...args: Parameters<MessageRenderer['renderTaskNotification']>): HTMLElement | null;
};

/** Runtime-facing projection port; detached execution never keeps an old renderer alive. */
export class RuntimeMessagePresentation implements MessagePresentation {
  private binding: { renderer: MessageRenderer; messagesEl: HTMLElement | null } | null = null;

  get messagesElement(): HTMLElement | null { return this.binding?.messagesEl ?? null; }

  attach(renderer: MessageRenderer, messagesEl: HTMLElement | null = null): () => void {
    const binding = { renderer, messagesEl };
    this.binding = binding;
    return () => { if (this.binding === binding) this.binding = null; };
  }

  appendInterruptIndicator(...args: Parameters<MessageRenderer['appendInterruptIndicator']>): ReturnType<MessageRenderer['appendInterruptIndicator']> {
    return this.binding?.renderer.appendInterruptIndicator(...args);
  }

  finalizeCompletedWork(...args: Parameters<MessageRenderer['finalizeCompletedWork']>): ReturnType<MessageRenderer['finalizeCompletedWork']> {
    return this.binding?.renderer.finalizeCompletedWork(...args);
  }

  finalizeTranscriptTurn(...args: Parameters<MessageRenderer['finalizeTranscriptTurn']>): ReturnType<MessageRenderer['finalizeTranscriptTurn']> {
    return this.binding?.renderer.finalizeTranscriptTurn(...args);
  }

  refreshActionButtons(...args: Parameters<MessageRenderer['refreshActionButtons']>): ReturnType<MessageRenderer['refreshActionButtons']> {
    return this.binding?.renderer.refreshActionButtons(...args);
  }

  removeMessage(...args: Parameters<MessageRenderer['removeMessage']>): ReturnType<MessageRenderer['removeMessage']> {
    return this.binding?.renderer.removeMessage(...args);
  }

  renderFinalMessageTimestamp(...args: Parameters<MessageRenderer['renderFinalMessageTimestamp']>): ReturnType<MessageRenderer['renderFinalMessageTimestamp']> {
    return this.binding?.renderer.renderFinalMessageTimestamp(...args);
  }

  setTranscriptExecutionScope(...args: Parameters<MessageRenderer['setTranscriptExecutionScope']>): ReturnType<MessageRenderer['setTranscriptExecutionScope']> {
    return this.binding?.renderer.setTranscriptExecutionScope(...args);
  }

  addTextCopyButton(...args: Parameters<MessageRenderer['addTextCopyButton']>): ReturnType<MessageRenderer['addTextCopyButton']> {
    return this.binding?.renderer.addTextCopyButton(...args);
  }

  startCompletedWork(...args: Parameters<MessageRenderer['startCompletedWork']>): ReturnType<MessageRenderer['startCompletedWork']> {
    return this.binding?.renderer.startCompletedWork(...args);
  }

  syncStreamingActivity(...args: Parameters<MessageRenderer['syncStreamingActivity']>): ReturnType<MessageRenderer['syncStreamingActivity']> {
    return this.binding?.renderer.syncStreamingActivity(...args);
  }

  refreshBranchButtonState(...args: Parameters<MessageRenderer['refreshBranchButtonState']>): ReturnType<MessageRenderer['refreshBranchButtonState']> {
    return this.binding?.renderer.refreshBranchButtonState(...args);
  }

  refreshBranchButtons(...args: Parameters<MessageRenderer['refreshBranchButtons']>): ReturnType<MessageRenderer['refreshBranchButtons']> {
    return this.binding?.renderer.refreshBranchButtons(...args);
  }

  renderMessagesInto(...args: Parameters<MessageRenderer['renderMessagesInto']>): ReturnType<MessageRenderer['renderMessagesInto']> {
    return this.binding?.renderer.renderMessagesInto(...args);
  }

  updateLiveUserMessage(...args: Parameters<MessageRenderer['updateLiveUserMessage']>): ReturnType<MessageRenderer['updateLiveUserMessage']> {
    return this.binding?.renderer.updateLiveUserMessage(...args);
  }

  addMessage(...args: Parameters<MessageRenderer['addMessage']>): HTMLElement | null {
    return this.binding?.renderer.addMessage(...args) ?? null;
  }

  renderMessages(...args: Parameters<MessageRenderer['renderMessages']>): HTMLElement | null {
    return this.binding?.renderer.renderMessages(...args) ?? null;
  }

  renderCitationGroup(...args: Parameters<MessageRenderer['renderCitationGroup']>): HTMLElement | null {
    return this.binding?.renderer.renderCitationGroup(...args) ?? null;
  }

  renderTaskNotification(...args: Parameters<MessageRenderer['renderTaskNotification']>): HTMLElement | null {
    return this.binding?.renderer.renderTaskNotification(...args) ?? null;
  }

  renderContent(...args: Parameters<MessageRenderer['renderContent']>): Promise<void> {
    return this.binding?.renderer.renderContent(...args) ?? Promise.resolve();
  }
}
