import { t } from '../../../i18n/i18n';
import { dispatchComposerInputEvent } from './ComposerInputEvents';

/** Displays and accepts the optional follow-up prompt suggested by Claude. */
export class PromptSuggestionController {
  private readonly inputEl: HTMLTextAreaElement;
  private readonly suggestionEl: HTMLButtonElement;
  private suggestion: string | null = null;

  constructor(containerEl: HTMLElement, inputEl: HTMLTextAreaElement) {
    this.inputEl = inputEl;
    this.suggestionEl = containerEl.createEl('button', {
      cls: 'claudian-prompt-suggestion',
      attr: { type: 'button' },
    });
    this.suggestionEl.hidden = true;
    this.suggestionEl.addEventListener('click', this.handleClick);
    containerEl.insertBefore(this.suggestionEl, containerEl.firstChild);
  }

  setSuggestion(value: string): void {
    const suggestion = value.trim();
    if (!suggestion) {
      this.clear();
      return;
    }

    this.suggestion = suggestion;
    this.suggestionEl.textContent = t('chat.promptSuggestion.label', { suggestion });
    this.suggestionEl.hidden = false;
  }

  clear(): void {
    this.suggestion = null;
    this.suggestionEl.hidden = true;
    this.suggestionEl.textContent = '';
  }

  handleKeydown(event: KeyboardEvent): boolean {
    if (
      !this.suggestion
      || event.isComposing
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
    ) {
      return false;
    }
    if (event.key === 'Tab') {
      this.accept();
      event.preventDefault();
      return true;
    }
    if (event.key !== 'ArrowRight') return false;

    const selectionStart = this.inputEl.selectionStart;
    const selectionEnd = this.inputEl.selectionEnd;
    if (
      selectionStart === null
      || selectionEnd === null
      || selectionStart !== selectionEnd
      || selectionEnd !== this.inputEl.value.length
    ) {
      return false;
    }

    this.accept();
    event.preventDefault();
    return true;
  }

  destroy(): void {
    this.suggestionEl.removeEventListener('click', this.handleClick);
    this.suggestionEl.remove();
    this.suggestion = null;
  }

  private readonly handleClick = (): void => {
    this.accept();
  };

  private accept(): void {
    if (!this.suggestion) return;
    const value = this.suggestion;
    this.clear();
    this.inputEl.value = value;
    this.inputEl.setSelectionRange?.(value.length, value.length);
    dispatchComposerInputEvent(this.inputEl);
    this.inputEl.focus();
  }
}
