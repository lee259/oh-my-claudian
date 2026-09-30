import { type App, Modal, Notice, Setting, type TextComponent } from 'obsidian';

import { t } from '../../../i18n/i18n';

export class ConversationRenameModal extends Modal {
  private titleInput: TextComponent | null = null;
  private isSaving = false;

  constructor(
    app: App,
    private readonly currentTitle: string,
    private readonly onSave: (title: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t('chat.history.rename'));
    this.modalEl.addClass('claudian-conversation-rename-modal');

    new Setting(this.contentEl).addText((text) => {
      this.titleInput = text;
      text
        .setValue(this.currentTitle)
        .setPlaceholder(this.currentTitle);
      text.inputEl.setAttribute('aria-label', t('chat.history.rename'));
      text.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          void this.save();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          this.close();
        }
      });
    });

    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText(t('common.cancel'))
        .onClick(() => this.close()))
      .addButton((button) => button
        .setButtonText(t('common.save'))
        .setCta()
        .onClick(() => void this.save()));

    this.titleInput?.inputEl.focus();
    this.titleInput?.inputEl.select();
  }

  onClose(): void {
    this.titleInput = null;
    this.contentEl.empty();
  }

  private async save(): Promise<void> {
    if (this.isSaving || !this.titleInput) return;

    const nextTitle = this.titleInput.getValue().trim();
    if (!nextTitle) return;
    if (nextTitle === this.currentTitle) {
      this.close();
      return;
    }

    this.isSaving = true;
    try {
      await this.onSave(nextTitle);
      this.close();
    } catch {
      new Notice(t('chat.errors.renameConversation'));
    } finally {
      this.isSaving = false;
    }
  }
}
