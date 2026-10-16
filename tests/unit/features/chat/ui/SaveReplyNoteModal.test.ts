/** @jest-environment jsdom */
import { fireEvent, getByRole } from '@testing-library/dom';
import { type App, MarkdownRenderer } from 'obsidian';

import { ReplyNoteWriteError, type ReplyNoteWriter } from '@/core/obsidian/ReplyNoteWriter';
import { SaveReplyNoteModal } from '@/features/chat/ui/SaveReplyNoteModal';

jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');
  return {
    ...actual,
    Modal: class {
      app: App;
      modalEl = document.createElement('div');
      contentEl = this.modalEl.createDiv();
      constructor(app: App) { this.app = app; }
      setTitle() {}
      open() { document.body.appendChild(this.modalEl); this.onOpen(); }
      close() { this.onClose(); this.modalEl.remove(); }
      onOpen() {}
      onClose() {}
    },
  };
});

const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };
HTMLElement.prototype.setText = function setText(value: string): void { this.textContent = value; };

describe('SaveReplyNoteModal', () => {
  afterEach(() => document.body.replaceChildren());

  it('lets the user edit and save a new note, then open or undo it', async () => {
    const undo = jest.fn().mockResolvedValue(undefined);
    const save = jest.fn().mockResolvedValue({ path: 'Summary.md', undo });
    const openLinkText = jest.fn().mockResolvedValue(undefined);
    const app = { workspace: { openLinkText } } as unknown as App;
    const modal = new SaveReplyNoteModal(app, { save } satisfies ReplyNoteWriter, '# Original');
    modal.open();
    fireEvent.input(getByRole(document.body, 'textbox', { name: 'Note path' }), { target: { value: 'Summary.md' } });
    fireEvent.input(getByRole(document.body, 'textbox', { name: 'Selected text' }), { target: { value: '# Reviewed\n\n[[Source]]' } });
    getByRole(document.body, 'button', { name: 'Save' }).click();
    getByRole(document.body, 'button', { name: 'Save' }).click();
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ mode: 'create', path: 'Summary.md', content: '# Reviewed\n\n[[Source]]' });
    getByRole(document.body, 'button', { name: 'Open note' }).click();
    await flush();
    expect(openLinkText).toHaveBeenCalledWith('Summary.md', '', true);
    getByRole(document.body, 'button', { name: 'Undo saved text' }).click();
    await flush();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('Saved text removed');
    modal.close();
  });

  it('preserves the edited draft on failure and can retry appending to an existing note', async () => {
    const save = jest.fn().mockRejectedValueOnce(new ReplyNoteWriteError('missingNote'))
      .mockResolvedValueOnce({ path: 'Notes/Existing.md', undo: jest.fn() });
    const app = { vault: { getMarkdownFiles: () => [{ path: 'Notes/Existing.md' }] } } as unknown as App;
    const modal = new SaveReplyNoteModal(app, { save }, 'Answer');
    modal.open();
    fireEvent.change(getByRole(document.body, 'combobox', { name: 'Destination' }), { target: { value: 'append' } });
    fireEvent.input(getByRole(document.body, 'combobox', { name: 'Note path' }), { target: { value: 'Notes/Existing.md' } });
    fireEvent.input(getByRole(document.body, 'textbox', { name: 'Selected text' }), { target: { value: 'Reviewed answer' } });
    getByRole(document.body, 'button', { name: 'Save' }).click();
    await flush();
    expect(document.body.textContent).toContain('The chosen note is no longer available');
    expect((getByRole(document.body, 'textbox', { name: 'Selected text' }) as HTMLTextAreaElement).value).toBe('Reviewed answer');
    getByRole(document.body, 'button', { name: 'Save' }).click();
    await flush();
    expect(save).toHaveBeenLastCalledWith({ mode: 'append', path: 'Notes/Existing.md', content: 'Reviewed answer' });
    expect(document.body.textContent).toContain('Saved to Notes/Existing.md');
    modal.close();
  });

  it('previews the edited Markdown and returns to the same draft', async () => {
    const modal = new SaveReplyNoteModal({} as App, { save: jest.fn() }, '# Answer\n\n[[Source]]');
    modal.open();
    const editor = getByRole(document.body, 'textbox', { name: 'Selected text' }) as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: '# Reviewed\n\n[[Source]]' } });
    getByRole(document.body, 'button', { name: 'Preview' }).click();
    await flush();
    expect(MarkdownRenderer.render).toHaveBeenCalledWith(expect.anything(), '# Reviewed\n\n[[Source]]', expect.any(HTMLElement), expect.any(String), expect.anything());
    expect(editor.hidden || editor.closest<HTMLElement>('.claudian-save-note-field')?.hidden).toBe(true);
    getByRole(document.body, 'button', { name: 'Edit' }).click();
    expect((getByRole(document.body, 'textbox', { name: 'Selected text' }) as HTMLTextAreaElement).value).toBe('# Reviewed\n\n[[Source]]');
    modal.close();
  });

  it('previews code as display-only content while retaining the original saved draft', async () => {
    const markdown = '<button>Example</button>\n\n```dataviewjs\ndv.list([])\n```';
    const save = jest.fn().mockResolvedValue({ path: 'Safe.md', undo: jest.fn() });
    jest.mocked(MarkdownRenderer.render).mockImplementationOnce(async (_app, rendered, target) => {
      const language = /^```(\S+)/m.exec(rendered)?.[1];
      (target as HTMLElement).createEl('pre').createEl('code', { cls: `language-${language}`, text: 'dv.list([])' });
    });
    const modal = new SaveReplyNoteModal({} as App, { save }, markdown);
    modal.open();
    fireEvent.input(getByRole(document.body, 'textbox', { name: 'Note path' }), { target: { value: 'Safe.md' } });

    getByRole(document.body, 'button', { name: 'Preview' }).click();
    await flush();

    expect(MarkdownRenderer.render).toHaveBeenLastCalledWith(expect.anything(),
      '&lt;button&gt;Example&lt;/button&gt;\n\n```claudian-display-only-fence-0\ndv.list([])\n```',
      expect.any(HTMLElement), 'Safe.md', expect.anything());
    expect(document.querySelector('.claudian-save-note-preview code')?.className).toBe('language-dataviewjs');
    getByRole(document.body, 'button', { name: 'Save' }).click();
    await flush();
    expect(save).toHaveBeenCalledWith({ mode: 'create', path: 'Safe.md', content: markdown });
    modal.close();
  });
});
