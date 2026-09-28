import type { AskUserQuestionItem, AskUserQuestionOption } from '../../../core/types/tools';

const CHECK_GLYPH = '\u2713';

export interface InlineAskQuestionConfig {
  onSubmit?: (answers: Record<string, string | string[]>) => Promise<void>;
  title?: string;
  headerEl?: HTMLElement;
  showCustomInput?: boolean;
  immediateSelect?: boolean;
}

export class InlineAskUserQuestion {
  private containerEl: HTMLElement;
  private input: Record<string, unknown>;
  private resolveCallback: (result: Record<string, string | string[]> | null) => void;
  private resolved = false;
  private submitting = false;
  private submissionError = '';
  private signal?: AbortSignal;
  private config: Required<Omit<InlineAskQuestionConfig, 'headerEl' | 'onSubmit'>>
    & Pick<InlineAskQuestionConfig, 'headerEl' | 'onSubmit'>;

  private questions: AskUserQuestionItem[] = [];
  private answers = new Map<number, Set<string>>();
  private customInputs = new Map<number, string>();

  private activeTabIndex = 0;
  private focusedItemIndex = 0;
  private isInputFocused = false;

  private rootEl!: HTMLElement;
  private tabBar!: HTMLElement;
  private contentArea!: HTMLElement;
  private tabElements: HTMLElement[] = [];
  private currentItems: HTMLElement[] = [];
  private boundKeyDown: (e: KeyboardEvent) => void;
  private abortHandler: (() => void) | null = null;

  constructor(
    containerEl: HTMLElement,
    input: Record<string, unknown>,
    resolve: (result: Record<string, string | string[]> | null) => void,
    signal?: AbortSignal,
    config?: InlineAskQuestionConfig,
  ) {
    this.containerEl = containerEl;
    this.input = input;
    this.resolveCallback = resolve;
    this.signal = signal;
    this.config = {
      onSubmit: config?.onSubmit,
      title: config?.title ?? 'Question',
      headerEl: config?.headerEl,
      showCustomInput: config?.showCustomInput ?? true,
      immediateSelect: config?.immediateSelect ?? false,
    };
    this.boundKeyDown = (event) => this.handleKeyDown(event);
  }

  render(): void {
    this.rootEl = this.containerEl.createDiv({ cls: 'claudian-ask-question-inline' });

    const titleEl = this.rootEl.createDiv({ cls: 'claudian-ask-inline-title' });
    titleEl.setText(this.config.title);

    if (this.config.headerEl) {
      this.rootEl.appendChild(this.config.headerEl);
    }

    this.questions = this.parseQuestions();

    if (this.questions.length === 0) {
      this.handleResolve(null);
      return;
    }

    if (this.config.immediateSelect && this.questions.length !== 1) {
      this.config.immediateSelect = false;
    }

    for (let i = 0; i < this.questions.length; i++) {
      this.answers.set(i, new Set());
      this.customInputs.set(i, '');
    }

    if (!this.config.immediateSelect) {
      this.tabBar = this.rootEl.createDiv({ cls: 'claudian-ask-tab-bar' });
      this.tabBar.setAttribute('role', 'group');
      this.tabBar.setAttribute('aria-label', 'Questions');
      this.renderTabBar();
    }
    this.contentArea = this.rootEl.createDiv({ cls: 'claudian-ask-content' });
    this.renderTabContent();

    this.rootEl.setAttribute('tabindex', '0');
    this.rootEl.addEventListener('keydown', this.boundKeyDown);

    // Defer focus to after the element is in the DOM and laid out
    window.requestAnimationFrame(() => {
      this.rootEl.focus();
      this.rootEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    if (this.signal) {
      this.abortHandler = () => this.handleResolve(null);
      this.signal.addEventListener('abort', this.abortHandler, { once: true });
    }
  }

  destroy(): void {
    this.handleResolve(null);
  }

  private parseQuestions(): AskUserQuestionItem[] {
    const raw = this.input.questions;
    if (!Array.isArray(raw)) return [];

    return (raw as unknown[])
      .filter(
        (q): q is {
          question: string;
          header?: string;
          options?: unknown[] | null;
          multiSelect?: boolean;
          isOther?: boolean;
          isSecret?: boolean;
          id?: string;
        } => {
          if (!q || typeof q !== 'object' || Array.isArray(q)) {
            return false;
          }
          const record = q as Record<string, unknown>;
          return typeof record.question === 'string'
            && ((Array.isArray(record.options) && record.options.length > 0) || record.isOther === true);
        },
      )
      .map((q, idx) => ({
        question: q.question,
        id: typeof (q as Record<string, unknown>).id === 'string' ? (q as Record<string, unknown>).id as string : undefined,
        header: typeof q.header === 'string' ? q.header.slice(0, 12) : `Q${idx + 1}`,
        options: this.deduplicateOptions((q.options ?? []).map((o) => this.coerceOption(o))),
        multiSelect: q.multiSelect === true,
        isOther: q.isOther === true,
        isSecret: q.isSecret === true,
      }));
  }

  private coerceOption(opt: unknown): AskUserQuestionOption {
    if (typeof opt === 'object' && opt !== null) {
      const obj = opt as Record<string, unknown>;
      const label = this.extractLabel(obj);
      const description = typeof obj.description === 'string' ? obj.description : '';
      const value = this.extractValue(obj, label);
      return { label, description, ...(value !== label ? { value } : {}) };
    }
    return { label: this.stringifyOptionValue(opt), description: '' };
  }

  private deduplicateOptions(options: AskUserQuestionOption[]): AskUserQuestionOption[] {
    const seen = new Set<string>();
    return options.filter((o) => {
      if (seen.has(o.label)) return false;
      seen.add(o.label);
      return true;
    });
  }

  private extractLabel(obj: Record<string, unknown>): string {
    if (typeof obj.label === 'string') return obj.label;
    if (typeof obj.value === 'string') return obj.value;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.name === 'string') return obj.name;
    return 'Option';
  }

  private stringifyOptionValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return `${value}`;
    }
    return 'Option';
  }

  private extractValue(obj: Record<string, unknown>, fallback: string): string {
    if (typeof obj.value === 'string') return obj.value;
    if (typeof obj.id === 'string') return obj.id;
    return fallback;
  }

  private renderTabBar(): void {
    this.tabBar.empty();
    this.tabElements = [];

    for (let idx = 0; idx < this.questions.length; idx++) {
      const answered = this.isQuestionAnswered(idx);
      const tab = this.tabBar.createEl('button', { cls: 'claudian-ask-tab' });
      tab.setAttribute('type', 'button');
      tab.createSpan({ text: answered ? CHECK_GLYPH : '', cls: 'claudian-ask-tab-step', attr: { 'aria-hidden': 'true' } });
      tab.createSpan({ text: this.questions[idx].header, cls: 'claudian-ask-tab-label' });
      tab.setAttribute('title', this.questions[idx].question);
      tab.setAttribute('aria-label', `${this.questions[idx].header}: ${this.questions[idx].question}${answered ? ', answered' : ', unanswered'}`);

      if (idx === this.activeTabIndex) {
        tab.addClass('is-active');
        tab.setAttribute('aria-current', 'step');
      }
      if (answered) tab.addClass('is-answered');
      tab.addEventListener('click', () => this.switchTab(idx));
      this.tabElements.push(tab);
    }

    const allAnswered = this.questions.every((_, i) => this.isQuestionAnswered(i));
    const submitTab = this.tabBar.createEl('button', { cls: 'claudian-ask-tab claudian-ask-tab--submit' });
    submitTab.setAttribute('type', 'button');
    submitTab.setAttribute('aria-label', 'Review answers');
    submitTab.createSpan({ text: 'Submit', cls: 'claudian-ask-tab-label' });
    if (allAnswered) submitTab.addClass('is-ready');
    if (this.activeTabIndex === this.questions.length) {
      submitTab.addClass('is-active');
      submitTab.setAttribute('aria-current', 'step');
    }
    submitTab.addEventListener('click', () => this.switchTab(this.questions.length));
    this.tabElements.push(submitTab);
  }

  private isQuestionAnswered(idx: number): boolean {
    return this.answers.get(idx)!.size > 0 || this.customInputs.get(idx)!.trim().length > 0;
  }

  private switchTab(index: number): void {
    if (this.submitting || this.resolved) return;
    const clamped = Math.max(0, Math.min(index, this.questions.length));
    if (clamped === this.activeTabIndex) return;
    this.activeTabIndex = clamped;
    this.focusedItemIndex = 0;
    this.isInputFocused = false;
    if (!this.config.immediateSelect) {
      this.renderTabBar();
    }
    this.renderTabContent();
    this.rootEl.focus();
  }

  private renderTabContent(): void {
    this.contentArea.empty();
    this.currentItems = [];

    if (this.activeTabIndex < this.questions.length) {
      this.renderQuestionTab(this.activeTabIndex);
    } else {
      this.renderSubmitTab();
    }
  }

  private renderQuestionTab(idx: number): void {
    const q = this.questions[idx];
    const isMulti = q.multiSelect;
    const selected = this.answers.get(idx)!;

    this.contentArea.createDiv({
      text: q.question,
      cls: 'claudian-ask-question-text',
    });

    const listEl = this.contentArea.createDiv({ cls: 'claudian-ask-list' });

    for (let optIdx = 0; optIdx < q.options.length; optIdx++) {
      const option = q.options[optIdx];
      const isFocused = optIdx === this.focusedItemIndex;
      const optionValue = this.getOptionValue(option);
      const isSelected = selected.has(optionValue);

      const row = listEl.createEl('button', { cls: 'claudian-ask-item' });
      row.setAttribute('type', 'button');
      row.setAttribute('aria-pressed', `${isSelected}`);
      row.setAttribute('aria-label', option.description ? `${option.label}: ${option.description}` : option.label);
      if (isFocused) row.addClass('is-focused');
      if (isSelected) row.addClass('is-selected');

      this.renderIndicator(row, isMulti, isSelected);

      const labelBlock = row.createSpan({ cls: 'claudian-ask-item-content' });
      const labelRow = labelBlock.createSpan({ cls: 'claudian-ask-label-row' });
      labelRow.createSpan({ text: option.label, cls: 'claudian-ask-item-label' });

      if (option.description) {
        labelBlock.createSpan({ text: option.description, cls: 'claudian-ask-item-desc' });
      }

      row.addEventListener('click', () => {
        this.focusedItemIndex = optIdx;
        this.updateFocusIndicator();
        this.selectOption(idx, option);
      });

      this.currentItems.push(row);
    }

    if (this.canShowCustomInputForQuestion(q)) {
      const customIdx = q.options.length;
      const customFocused = customIdx === this.focusedItemIndex;
      const customText = this.customInputs.get(idx) ?? '';
      const hasCustomText = customText.trim().length > 0;

      const customRow = listEl.createDiv({ cls: 'claudian-ask-item claudian-ask-custom-item' });
      if (customFocused) customRow.addClass('is-focused');
      if (hasCustomText) customRow.addClass('is-selected');
      this.renderIndicator(customRow, isMulti, hasCustomText);

      const inputEl = customRow.createEl('input', {
        cls: 'claudian-ask-custom-text',
        value: customText,
      });
      inputEl.setAttribute('type', q.isSecret ? 'password' : 'text');
      inputEl.setAttribute('aria-label', q.question);
      inputEl.setAttribute('placeholder', q.isSecret ? 'Enter secret…' : 'Type your own answer…');

      inputEl.addEventListener('input', () => {
        this.customInputs.set(idx, inputEl.value);
        const hasText = inputEl.value.trim().length > 0;
        customRow.toggleClass('is-selected', hasText);
        this.setIndicator(customRow, isMulti, hasText);
        if (!isMulti && inputEl.value.trim()) {
          selected.clear();
          this.updateOptionVisuals(idx);
        }
        this.updateTabIndicators();
      });
      inputEl.addEventListener('focus', () => {
        this.isInputFocused = true;
      });
      inputEl.addEventListener('blur', () => {
        this.isInputFocused = false;
      });

      customRow.addEventListener('click', () => {
        this.focusedItemIndex = customIdx;
        this.updateFocusIndicator();
        inputEl.focus();
      });

      this.currentItems.push(customRow);
    }

  }

  private renderSubmitTab(): void {
    this.contentArea.createDiv({
      text: 'Review your answers',
      cls: 'claudian-ask-review-title',
    });

    const reviewEl = this.contentArea.createDiv({ cls: 'claudian-ask-review' });

    for (let idx = 0; idx < this.questions.length; idx++) {
      const q = this.questions[idx];
      const answerText = this.getAnswerText(idx);

      const pairEl = reviewEl.createEl('button', { cls: 'claudian-ask-review-pair' });
      pairEl.setAttribute('type', 'button');
      pairEl.setAttribute('aria-label', `Edit answer for ${q.question}`);
      const bodyEl = pairEl.createSpan({ cls: 'claudian-ask-review-body' });
      bodyEl.createSpan({ text: q.question, cls: 'claudian-ask-review-q-text' });
      bodyEl.createSpan({
        text: answerText || 'Not answered',
        cls: answerText ? 'claudian-ask-review-a-text' : 'claudian-ask-review-empty',
      });
      pairEl.addEventListener('click', () => this.switchTab(idx));
    }

    this.contentArea.createDiv({
      text: 'Ready to submit your answers?',
      cls: 'claudian-ask-review-prompt',
    });

    const actionsEl = this.contentArea.createDiv({ cls: 'claudian-ask-actions' });
    const allAnswered = this.questions.every((_, i) => this.isQuestionAnswered(i));

    const submitRow = actionsEl.createEl('button', { cls: 'claudian-ask-item claudian-ask-action claudian-ask-action--primary' });
    submitRow.setAttribute('type', 'button');
    submitRow.setAttribute('aria-disabled', `${!allAnswered}`);
    submitRow.setAttribute('aria-label', 'Submit answers');
    if (this.focusedItemIndex === 0) submitRow.addClass('is-focused');
    if (!allAnswered) submitRow.addClass('is-disabled');
    submitRow.disabled = this.submitting || !allAnswered;
    submitRow.setAttribute('aria-label', this.submitting ? 'Sending...' : 'Submit answers');
    submitRow.createSpan({ text: this.submitting ? 'Sending...' : 'Submit answers', cls: 'claudian-ask-item-label' });
    submitRow.addEventListener('click', () => {
      this.focusedItemIndex = 0;
      this.updateFocusIndicator();
      this.handleSubmit();
    });
    this.currentItems.push(submitRow);

    const cancelRow = actionsEl.createEl('button', { cls: 'claudian-ask-item claudian-ask-action' });
    cancelRow.setAttribute('type', 'button');
    cancelRow.setAttribute('aria-label', 'Cancel');
    cancelRow.disabled = this.submitting;
    if (this.focusedItemIndex === 1) cancelRow.addClass('is-focused');
    cancelRow.createSpan({ text: 'Cancel', cls: 'claudian-ask-item-label' });
    cancelRow.addEventListener('click', () => {
      if (this.submitting) return;
      this.focusedItemIndex = 1;
      this.handleResolve(null);
    });
    this.currentItems.push(cancelRow);

    if (this.submissionError) {
      this.contentArea.createDiv({ text: this.submissionError, cls: 'claudian-ask-error', attr: { role: 'alert' } });
    }
  }

  private getAnswerText(idx: number): string {
    const selected = this.getSelectedLabels(idx);
    const custom = this.customInputs.get(idx)!;
    const parts: string[] = [];
    if (selected.length > 0) parts.push(selected.join(', '));
    if (custom.trim()) parts.push(custom.trim());
    return parts.join(', ');
  }

  private selectOption(qIdx: number, option: AskUserQuestionOption): void {
    if (this.submitting || this.resolved) return;
    const q = this.questions[qIdx];
    const selected = this.answers.get(qIdx)!;
    const isMulti = q.multiSelect;
    const optionValue = this.getOptionValue(option);

    if (isMulti) {
      if (selected.has(optionValue)) {
        selected.delete(optionValue);
      } else {
        selected.add(optionValue);
      }
    } else {
      selected.clear();
      selected.add(optionValue);
      this.customInputs.set(qIdx, '');
    }

    this.updateOptionVisuals(qIdx);

    if (this.config.immediateSelect) {
      const key = q.id ?? q.question;
      const result: Record<string, string> = {};
      result[key] = optionValue;
      this.handleResolve(result);
      return;
    }

    this.updateTabIndicators();

    if (!isMulti) {
      this.switchTab(this.activeTabIndex + 1);
    }
  }

  private renderIndicator(parent: HTMLElement, isMulti: boolean, checked: boolean): void {
    parent.createSpan({
      cls: `${isMulti ? 'claudian-ask-check' : 'claudian-ask-radio'}${checked ? ' is-checked' : ''}`,
      attr: { 'aria-hidden': 'true' },
    });
  }

  private setIndicator(parent: HTMLElement, isMulti: boolean, checked: boolean): void {
    const indicator = parent.querySelector(isMulti ? '.claudian-ask-check' : '.claudian-ask-radio');
    indicator?.toggleClass('is-checked', checked);
  }

  private updateOptionVisuals(qIdx: number): void {
    const q = this.questions[qIdx];
    const selected = this.answers.get(qIdx)!;
    const isMulti = q.multiSelect;

    for (let i = 0; i < q.options.length; i++) {
      const item = this.currentItems[i];
      const isSelected = selected.has(this.getOptionValue(q.options[i]));

      item.toggleClass('is-selected', isSelected);
      item.setAttribute('aria-pressed', `${isSelected}`);

      this.setIndicator(item, isMulti, isSelected);
    }

    if (!isMulti && this.canShowCustomInputForQuestion(q)) {
      const customRow = this.currentItems[q.options.length];
      const hasCustomText = this.customInputs.get(qIdx)!.trim().length > 0;
      customRow?.toggleClass('is-selected', hasCustomText);
      if (customRow) this.setIndicator(customRow, false, hasCustomText);
    }
  }

  private updateFocusIndicator(): void {
    for (let i = 0; i < this.currentItems.length; i++) {
      const item = this.currentItems[i];
      if (i === this.focusedItemIndex) {
        item.addClass('is-focused');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.removeClass('is-focused');
      }
    }
  }

  private updateTabIndicators(): void {
    for (let idx = 0; idx < this.questions.length; idx++) {
      const tab = this.tabElements[idx];
      const step = tab.querySelector('.claudian-ask-tab-step');
      const answered = this.isQuestionAnswered(idx);
      tab.toggleClass('is-answered', answered);
      tab.setAttribute('aria-label', `${this.questions[idx].header}: ${this.questions[idx].question}${answered ? ', answered' : ', unanswered'}`);
      if (step) step.textContent = answered ? CHECK_GLYPH : '';
    }
    const submitTab = this.tabElements[this.questions.length];
    if (submitTab) {
      const allAnswered = this.questions.every((_, i) => this.isQuestionAnswered(i));
      submitTab.toggleClass('is-ready', allAnswered);
    }
  }

  private handleNavigationKey(e: KeyboardEvent, maxFocusIndex: number): boolean {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        this.focusedItemIndex = Math.min(this.focusedItemIndex + 1, maxFocusIndex);
        this.updateFocusIndicator();
        return true;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        this.focusedItemIndex = Math.max(this.focusedItemIndex - 1, 0);
        this.updateFocusIndicator();
        return true;
      case 'ArrowLeft':
        if (this.config.immediateSelect) return false;
        e.preventDefault();
        e.stopPropagation();
        this.switchTab(this.activeTabIndex - 1);
        return true;
      case 'Tab':
        if (this.config.immediateSelect) return false;
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          this.switchTab(this.activeTabIndex - 1);
        } else {
          this.switchTab(this.activeTabIndex + 1);
        }
        return true;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.handleResolve(null);
        return true;
      default:
        return false;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.isComposing) return;
    if (this.submitting) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (this.isInputFocused) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.isInputFocused = false;
        (this.rootEl.ownerDocument.activeElement as HTMLElement | null)?.blur();
        this.rootEl.focus();
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.isInputFocused = false;
        (this.rootEl.ownerDocument.activeElement as HTMLElement | null)?.blur();
        if (e.key === 'Tab' && e.shiftKey) {
          this.switchTab(this.activeTabIndex - 1);
        } else {
          this.switchTab(this.activeTabIndex + 1);
        }
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        (this.rootEl.ownerDocument.activeElement as HTMLElement | null)?.blur();
        this.isInputFocused = false;
        const q = this.questions[this.activeTabIndex];
        const maxIdx = this.canShowCustomInputForQuestion(q) ? q.options.length : q.options.length - 1;
        if (e.key === 'ArrowUp') {
          this.focusedItemIndex = Math.max(this.focusedItemIndex - 1, 0);
        } else {
          this.focusedItemIndex = Math.min(this.focusedItemIndex + 1, maxIdx);
        }
        this.updateFocusIndicator();
        this.rootEl.focus();
        return;
      }
      return;
    }

    if (this.config.immediateSelect) {
      const q = this.questions[this.activeTabIndex];
      const maxIdx = q.options.length - 1;
      if (this.handleNavigationKey(e, maxIdx)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (this.focusedItemIndex <= maxIdx) {
          this.selectOption(this.activeTabIndex, q.options[this.focusedItemIndex]);
        }
      }
      return;
    }

    const isSubmitTab = this.activeTabIndex === this.questions.length;
    const q = this.questions[this.activeTabIndex];
    const maxFocusIndex = isSubmitTab
      ? 1
      : (this.canShowCustomInputForQuestion(q) ? q.options.length : q.options.length - 1);

    if (this.handleNavigationKey(e, maxFocusIndex)) return;

    if (isSubmitTab) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (this.focusedItemIndex === 0) this.handleSubmit();
        else this.handleResolve(null);
      }
      return;
    }

    // Question tab: ArrowRight and Enter
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        this.switchTab(this.activeTabIndex + 1);
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (this.focusedItemIndex < q.options.length) {
          this.selectOption(this.activeTabIndex, q.options[this.focusedItemIndex]);
        } else if (this.canShowCustomInputForQuestion(q)) {
          this.isInputFocused = true;
          const customRow = this.currentItems[this.focusedItemIndex];
          const input = customRow?.querySelector('.claudian-ask-custom-text') as HTMLInputElement;
          input?.focus();
        }
        break;
    }
  }

  private handleSubmit(): void {
    if (this.submitting || this.resolved) return;
    const allAnswered = this.questions.every((_, i) => this.isQuestionAnswered(i));
    if (!allAnswered) return;

    const result: Record<string, string | string[]> = {};
    for (let i = 0; i < this.questions.length; i++) {
      const question = this.questions[i];
      const key = question.id ?? question.question;
      const selectedValues = [...this.answers.get(i)!];
      const customInput = this.customInputs.get(i)!.trim();

      if (question.multiSelect) {
        const answers = [...selectedValues];
        if (customInput) {
          answers.push(customInput);
        }
        result[key] = answers;
        continue;
      }

      result[key] = customInput || selectedValues[0] || '';
    }
    if (!this.config.onSubmit) {
      this.handleResolve(result);
      return;
    }

    this.submitting = true;
    this.rootEl.setAttribute('aria-busy', 'true');
    this.renderTabContent();
    void this.config.onSubmit(result).then(() => {
      if (!this.resolved) this.handleResolve(result);
    }).catch((error: unknown) => {
      if (this.resolved) return;
      this.submitting = false;
      this.submissionError = error instanceof Error ? error.message : 'Could not send the answer. Please try again.';
      this.rootEl.setAttribute('aria-busy', 'false');
      this.renderTabContent();
    });
  }

  private canShowCustomInputForQuestion(question: AskUserQuestionItem): boolean {
    return this.config.showCustomInput && question.isOther === true;
  }

  private getOptionValue(option: AskUserQuestionOption): string {
    return option.value ?? option.label;
  }

  private getSelectedLabels(idx: number): string[] {
    const selected = this.answers.get(idx)!;
    const question = this.questions[idx];
    return question.options
      .filter(option => selected.has(this.getOptionValue(option)))
      .map(option => option.label);
  }

  private handleResolve(result: Record<string, string | string[]> | null): void {
    if (!this.resolved) {
      this.resolved = true;
      this.rootEl?.removeEventListener('keydown', this.boundKeyDown);
      if (this.signal && this.abortHandler) {
        this.signal.removeEventListener('abort', this.abortHandler);
        this.abortHandler = null;
      }
      this.rootEl?.remove();
      this.resolveCallback(result);
    }
  }
}
