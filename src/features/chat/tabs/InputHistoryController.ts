import type { ChatMessage } from '../../../core/types';
import { isCanonicalUserMessage } from '../../../core/types';
import { extractUserDisplayContent } from '../../../utils/context';
import { dispatchComposerInputEvent } from '../ui/ComposerInputEvents';

export interface InputHistoryControllerDeps {
  getMessages: () => readonly ChatMessage[];
  getConversationId: () => string | null;
}

type InputHistoryDirection = 'up' | 'down';

function isHistoryNavigationKey(event: KeyboardEvent): boolean {
  return (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    && !event.isComposing
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey;
}

function isAtInputBoundary(input: HTMLTextAreaElement, direction: InputHistoryDirection): boolean {
  const selectionStart = input.selectionStart;
  const selectionEnd = input.selectionEnd;
  if (selectionStart === null || selectionEnd === null || selectionStart !== selectionEnd) {
    return false;
  }

  // A single-line composer has no useful vertical caret navigation, so both
  // arrows should be available regardless of the horizontal caret position.
  if (!input.value.includes('\n')) return true;

  return direction === 'up'
    ? selectionStart === 0
    : selectionEnd === input.value.length;
}

function getInputHistory(messages: readonly ChatMessage[]): string[] {
  return messages
    .filter(isCanonicalUserMessage)
    .map(message => message.displayContent
      ?? extractUserDisplayContent(message.content)
      ?? message.content)
    .filter(content => content.trim().length > 0);
}

/** Navigates canonical user prompts while preserving the current composer draft. */
export class InputHistoryController {
  private readonly deps: InputHistoryControllerDeps;
  private inputHistoryIndex: number | null = null;
  private inputHistoryDraft = '';
  private inputHistoryConversationId: string | null;
  private restoringInputHistory = false;

  constructor(deps: InputHistoryControllerDeps) {
    this.deps = deps;
    this.inputHistoryConversationId = deps.getConversationId();
  }

  handleKeydown(event: KeyboardEvent, input: HTMLTextAreaElement): boolean {
    if (!isHistoryNavigationKey(event)) return false;

    const direction = event.key === 'ArrowUp' ? 'up' : 'down';
    if (!isAtInputBoundary(input, direction)) return false;

    if (this.inputHistoryConversationId !== this.deps.getConversationId()) {
      this.reset();
    }

    const history = getInputHistory(this.deps.getMessages());
    if (history.length === 0) return false;

    let nextIndex: number | null;
    if (direction === 'up') {
      if (this.inputHistoryIndex === null) {
        this.inputHistoryDraft = input.value;
        nextIndex = history.length - 1;
      } else {
        nextIndex = this.inputHistoryIndex - 1;
        if (nextIndex < 0) return false;
      }
    } else {
      if (this.inputHistoryIndex === null) return false;
      nextIndex = this.inputHistoryIndex + 1;
      if (nextIndex >= history.length) {
        nextIndex = null;
      }
    }

    this.inputHistoryIndex = nextIndex;
    const nextValue = nextIndex === null ? this.inputHistoryDraft : history[nextIndex];
    this.restoringInputHistory = true;
    input.value = nextValue;
    input.setSelectionRange?.(nextValue.length, nextValue.length);
    dispatchComposerInputEvent(input);
    this.restoringInputHistory = false;
    event.preventDefault();
    return true;
  }

  handleInput(): void {
    if (this.restoringInputHistory) return;
    this.reset();
  }

  reset(): void {
    this.inputHistoryIndex = null;
    this.inputHistoryDraft = '';
    this.inputHistoryConversationId = this.deps.getConversationId();
  }
}
