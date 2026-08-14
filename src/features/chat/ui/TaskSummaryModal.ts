import { Modal, Notice } from 'obsidian';

import type { TaskSummaryDraft } from '../../../core/task/TaskSummary';

export class TaskSummaryModal extends Modal {
  private readonly draft: TaskSummaryDraft;
  private readonly onSave: (draft: TaskSummaryDraft) => Promise<void>;
  private saving = false;

  constructor(
    app: Modal['app'],
    draft: TaskSummaryDraft,
    onSave: (draft: TaskSummaryDraft) => Promise<void>,
  ) {
    super(app);
    this.draft = draft;
    this.onSave = onSave;
  }

  onOpen(): void {
    this.setTitle('Complete task');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('claudian-task-summary-modal');
    contentEl.createDiv({
      cls: 'claudian-task-summary-modal-description',
      text: 'Save a short record of what changed and what remains to do.',
    });

    const pathField = contentEl.createDiv({ cls: 'claudian-task-summary-field' });
    pathField.createEl('label', {
      cls: 'claudian-task-summary-label',
      attr: { for: 'claudian-task-summary-path' },
      text: 'Save location',
    });
    const pathInput = pathField.createEl('input', {
      cls: 'claudian-task-summary-path',
      attr: {
        type: 'text',
        spellcheck: 'false',
        id: 'claudian-task-summary-path',
        'aria-label': 'Save location',
      },
      value: this.draft.path,
    });

    const contentField = contentEl.createDiv({ cls: 'claudian-task-summary-field' });
    contentField.createEl('label', {
      cls: 'claudian-task-summary-label',
      attr: { for: 'claudian-task-summary-content' },
      text: 'Summary',
    });
    const contentInput = contentField.createEl('textarea', {
      cls: 'claudian-task-summary-content',
      attr: {
        spellcheck: 'false',
        id: 'claudian-task-summary-content',
        'aria-label': 'Summary',
      },
    });
    contentInput.value = this.draft.content;

    const actions = contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { text: 'Save summary' });
    save.addClass('mod-cta');
    save.addEventListener('click', () => {
      if (this.saving) return;
      this.saving = true;
      save.disabled = true;
      void this.onSave({ path: pathInput.value, content: contentInput.value })
        .then(() => this.close())
        .catch(error => {
          this.saving = false;
          save.disabled = false;
          new Notice(error instanceof Error ? error.message : 'Failed to save task summary');
        });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
