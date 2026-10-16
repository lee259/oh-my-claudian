import { type App, Component, MarkdownRenderer, Modal, Notice } from 'obsidian';

import { ReplyNoteWriteError, type ReplyNoteWriter, type ReplyNoteWriteReceipt } from '@/core/obsidian/ReplyNoteWriter';
import { t } from '@/i18n/i18n';
import { escapeRawHtmlTags } from '@/utils/markdownHtml';

import { prepareDisplayOnlyCodeFences, restoreDisplayOnlyCodeFences } from '../rendering/DisplayOnlyCodeFences';

/** A user-reviewed vault write. Provider sessions and transcripts remain untouched. */
export class SaveReplyNoteModal extends Modal {
  private static nextId = 0;
  private busy = false;
  private closed = false;
  private mode: 'create' | 'append' = 'create';
  private receipt?: ReplyNoteWriteReceipt;
  private previewComponent?: Component;
  private statusEl!: HTMLElement;
  private readonly controls: Array<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = [];

  constructor(app: App, private readonly writer: ReplyNoteWriter, private readonly markdown: string, private readonly onClosed?: () => void) {
    super(app);
  }

  onOpen(): void {
    this.closed = false;
    this.setTitle(t('chat.saveNote.title'));
    this.modalEl.addClass('claudian-save-note-modal');
    this.contentEl.empty();
    const id = `claudian-save-note-${SaveReplyNoteModal.nextId++}`;
    const destination = this.field(t('chat.saveNote.destination'), `${id}-mode`);
    const mode = destination.createEl('select', { attr: { id: `${id}-mode` } });
    mode.createEl('option', { text: t('chat.saveNote.newNote'), attr: { value: 'create' } });
    mode.createEl('option', { text: t('chat.saveNote.append'), attr: { value: 'append' } });
    const pathField = this.field(t('chat.saveNote.path'), `${id}-path`);
    const path = pathField.createEl('input', { attr: { id: `${id}-path`, type: 'text' } });
    const heading = /^#\s+(.+)$/m.exec(this.markdown)?.[1] ?? `${t('chat.saveNote.defaultName')} ${Date.now()}`;
    path.value = `${heading.replace(/[\\/:*?"<>|\p{Cc}]/gu, '-').replace(/^\.+/, '').trim().slice(0, 100) || t('chat.saveNote.defaultName')}.md`;
    const newPath = path.value;
    const suggestions = pathField.createEl('datalist', { attr: { id: `${id}-notes` } });
    const updateSuggestions = () => {
      suggestions.empty();
      if (this.mode !== 'append') return;
      const query = path.value.toLocaleLowerCase();
      for (const file of this.app.vault.getMarkdownFiles()
        .filter(file => file.path.toLocaleLowerCase().includes(query)).slice(0, 50)) {
        suggestions.createEl('option', { attr: { value: file.path } });
      }
    };
    path.addEventListener('input', updateSuggestions);
    mode.addEventListener('change', () => {
      this.mode = mode.value === 'append' ? 'append' : 'create';
      path.value = this.mode === 'create' ? newPath : '';
      if (this.mode === 'append') path.setAttribute('list', `${id}-notes`);
      else path.removeAttribute('list');
      updateSuggestions();
      path.focus();
    });

    const answerField = this.field(t('chat.saveNote.answer'), `${id}-answer`);
    const editor = answerField.createEl('textarea', {
      cls: 'claudian-save-note-editor', attr: { id: `${id}-answer`, rows: '10' },
    });
    editor.value = this.markdown;
    const preview = this.contentEl.createDiv({ cls: 'claudian-save-note-preview markdown-rendered' });
    preview.hidden = true;
    const actions = this.contentEl.createDiv({ cls: 'claudian-save-note-actions' });
    const previewButton = this.button(actions, t('chat.saveNote.preview'), () => {
      const showPreview = preview.hidden;
      preview.hidden = !showPreview;
      answerField.hidden = showPreview;
      previewButton.textContent = t(showPreview ? 'chat.saveNote.edit' : 'chat.saveNote.preview');
      previewButton.setAttribute('aria-pressed', String(showPreview));
      this.previewComponent?.unload();
      if (showPreview) {
        preview.empty();
        const target = preview.createDiv();
        const component = new Component();
        component.load();
        this.previewComponent = component;
        const prepared = prepareDisplayOnlyCodeFences(escapeRawHtmlTags(editor.value));
        void MarkdownRenderer.render(this.app, prepared.markdown, target, path.value, component)
          .then(() => {
            if (!this.closed && this.previewComponent === component) {
              return restoreDisplayOnlyCodeFences(target, prepared.fences);
            }
          })
          .catch(() => { if (!this.closed) target.setText(t('chat.saveNote.previewFailed')); });
      }
    });
    previewButton.setAttribute('aria-pressed', 'false');
    this.button(actions, t('common.cancel'), () => this.close(), false);
    this.button(actions, t('common.save'), () => {
      const target = path.value.trim();
      void this.save(target.toLowerCase().endsWith('.md') ? target : `${target}.md`, editor.value);
    });
    this.controls.push(mode, path, editor);
    this.statusEl = this.contentEl.createDiv({ cls: 'claudian-save-note-status', attr: { role: 'status', 'aria-live': 'polite' } });
    path.focus();
    path.select();
  }

  onClose(): void {
    this.closed = true;
    this.previewComponent?.unload();
    this.controls.length = 0;
    this.contentEl.empty();
    this.onClosed?.();
  }

  private field(label: string, id: string): HTMLElement {
    const field = this.contentEl.createDiv({ cls: 'claudian-save-note-field' });
    field.createEl('label', { text: label, attr: { for: id } });
    return field;
  }

  private button(parent: HTMLElement, label: string, onClick: () => void, disableWhileBusy = true): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'claudian-save-note-button', text: label, attr: { type: 'button' } });
    button.addEventListener('click', onClick);
    if (disableWhileBusy) this.controls.push(button);
    return button;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    for (const control of this.controls) control.disabled = busy;
  }

  private showError(error: unknown): void {
    this.statusEl.setText(error instanceof ReplyNoteWriteError
      ? t(`chat.saveNote.${error.code}`)
      : t('chat.saveNote.failed'));
  }

  private async save(path: string, content: string): Promise<void> {
    if (this.busy || this.receipt) return;
    this.setBusy(true);
    try {
      this.receipt = await this.writer.save({ mode: this.mode, path, content });
      if (this.closed) { new Notice(t('chat.saveNote.saved', { path: this.receipt.path })); return; }
      this.showSaved();
    } catch (error) {
      if (!this.closed) this.showError(error);
    } finally {
      this.setBusy(false);
    }
  }

  private showSaved(): void {
    this.previewComponent?.unload();
    this.controls.length = 0;
    this.contentEl.empty();
    this.statusEl = this.contentEl.createDiv({ cls: 'claudian-save-note-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.statusEl.setText(t('chat.saveNote.saved', { path: this.receipt!.path }));
    this.contentEl.createEl('p', { cls: 'claudian-save-note-hint', text: t('chat.saveNote.undoHint') });
    const actions = this.contentEl.createDiv({ cls: 'claudian-save-note-actions' });
    this.button(actions, t('chat.saveNote.open'), () => {
      void this.app.workspace.openLinkText(this.receipt!.path, '', true).catch(error => this.showError(error));
    });
    const undo = this.button(actions, t('chat.saveNote.undo'), () => {
      if (this.busy) return;
      this.setBusy(true);
      void this.receipt!.undo().then(() => {
        if (!this.closed) {
          this.statusEl.setText(t('chat.saveNote.undone'));
          undo.remove();
          this.controls.splice(this.controls.indexOf(undo), 1);
        }
      }).catch(error => { if (!this.closed) this.showError(error); })
        .finally(() => this.setBusy(false));
    });
    this.button(actions, t('chat.saveNote.close'), () => this.close(), false);
  }
}
