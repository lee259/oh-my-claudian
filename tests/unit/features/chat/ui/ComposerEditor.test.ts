/** @jest-environment jsdom */

import { redo, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { getByRole } from '@testing-library/dom';
import { axe } from 'jest-axe';
import { Notice } from 'obsidian';

import { RuntimeComposer } from '@/features/chat/sessions/RuntimeComposer';
import { ComposerEditor } from '@/features/chat/ui/ComposerEditor';
import { ImageContextManager } from '@/features/chat/ui/ImageContext';
import { setLocale } from '@/i18n/i18n';
import { MentionDropdownController } from '@/shared/mention/MentionDropdownController';

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
HTMLElement.prototype.setText ??= function (text: string): void { this.textContent = text; };
HTMLElement.prototype.scrollIntoView ??= jest.fn();

describe('short-name composer editor', () => {
  const instances: ComposerEditor[] = [];
  afterEach(() => {
    setLocale('en');
    for (const editor of instances.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  it('localizes the empty input and its accessible name without changing the draft', () => {
    setLocale('zh-CN');
    const { input, parent } = fixture('');
    expect(input.placeholder).toBe('描述修改需求，@引用文件，运行 /命令');
    expect(parent.querySelector('.cm-placeholder')?.textContent).toBe(input.placeholder);
    expect(getByRole(parent, 'textbox', { name: '消息' })).toBe(input.getAccessibleTextbox?.());
    input.value = 'Please keep this draft in English';
    expect(input.value).toBe('Please keep this draft in English');
  });

  function fixture(text: string) {
    const parent = document.body.createDiv();
    const files = new Map(['one/plan.md', 'two/plan.md', 'notes/a plan.md', 'review.md'].map(path => [path, {
      path, name: path.slice(path.lastIndexOf('/') + 1), extension: 'md',
    }]));
    const app = {
      vault: { getAbstractFileByPath: (path: string) => path === 'projects' ? { path, name: 'projects' } : files.get(path) ?? null },
      metadataCache: { getFirstLinkpathDest: (path: string) => files.get(path) ?? files.get(`${path}.md`) ?? [...files.values()].find(file => file.name === path) ?? null },
      workspace: { openLinkText: jest.fn() },
    } as any;
    const editor = new ComposerEditor(parent, app);
    instances.push(editor);
    const input = editor.element;
    input.value = text;
    input.focus();
    const view = EditorView.findFromDOM(parent.querySelector('.cm-editor') as HTMLElement)!;
    return { editor, input, view, parent, app };
  }

  it('keeps an accessible name before and after mounting without triggering Obsidian label tooltips', () => {
    const parent = document.body.createDiv();
    const editor = new ComposerEditor(parent, {} as any);
    instances.push(editor);
    const assertTextbox = () => {
      const textbox = getByRole(parent, 'textbox', { name: 'Message' });
      expect(textbox).toBe(editor.element.getAccessibleTextbox?.());
      expect(textbox.hasAttribute('aria-label')).toBe(false);
      expect(textbox.hasAttribute('title')).toBe(false);
    };

    assertTextbox();
    editor.element.focus();
    assertTextbox();
  });

  it('displays short names and keeps distinct full paths in the canonical value and selection', () => {
    const text = 'Compare @one/plan.md and @two/plan.md ';
    const { input, parent } = fixture(text);
    expect([...parent.querySelectorAll('.claudian-composer-file-name')].map(el => el.textContent)).toEqual(['plan', 'plan']);
    expect(input.getAccessibleTextbox?.().textContent).not.toContain('one/');
    expect(input.value).toBe(text);
    input.setSelectionRange(0, text.length);
    expect(input.value.slice(input.selectionStart!, input.selectionEnd!)).toBe(text);
  });

  it('does not turn a bare MCP or agent name into a file through implicit Markdown resolution', () => {
    const { input, parent } = fixture('@review ');
    expect(input.value).toBe('@review ');
    expect(parent.querySelector('.claudian-composer-file')).toBeNull();
  });

  it('still resolves an explicit filename to its full vault path', () => {
    const { parent, app } = fixture('@plan.md ');
    (parent.querySelector('.claudian-composer-file') as HTMLElement).click();
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('one/plan.md', '', 'tab');
  });

  it('opens the exact referenced file with an ordinary click', () => {
    const { parent, app } = fixture('@two/plan.md ');
    (parent.querySelector('.claudian-composer-file') as HTMLElement).click();
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('two/plan.md', '', 'tab');
  });

  it.each(['click', 'Enter', ' '] as const)('handles failed folder activation by %s without changing the canonical draft', async action => {
    jest.mocked(Notice).mockClear();
    const { parent, app, input } = fixture('@projects/ ');
    const reveal = jest.fn().mockRejectedValueOnce(new Error('PRIVATE_SENTINEL')).mockResolvedValue(undefined);
    app.workspace.getLeavesOfType = () => [{ view: { revealInFolder: reveal } }];
    const link = parent.querySelector<HTMLElement>('.claudian-composer-file')!;
    const activate = () => action === 'click' ? link.click()
      : link.dispatchEvent(new KeyboardEvent('keydown', { key: action, bubbles: true, cancelable: true }));
    activate();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(Notice).toHaveBeenCalledWith('Could not reveal file or folder.');
    expect(input.value).toBe('@projects/ ');
    activate();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reveal).toHaveBeenCalledTimes(2);
    expect(Notice).toHaveBeenCalledTimes(1);
  });

  it('reports failure from a marked folder path and retains its draft', async () => {
    jest.mocked(Notice).mockClear();
    const { view, app, input } = fixture('@projects/');
    const reveal = jest.fn().mockImplementation(() => { throw new Error('PRIVATE_SENTINEL'); });
    app.workspace.getLeavesOfType = () => [{ view: { revealInFolder: reveal } }];
    const link = view.contentDOM.createSpan({ attr: { 'data-composer-path': 'projects', 'data-composer-folder': 'true' } });
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(Notice).toHaveBeenCalledWith('Could not reveal file or folder.');
    expect(input.value).toBe('@projects/');
  });

  it('creates detached widgets through the owning window rather than appending to Document', () => {
    const original = document.createSpan;
    document.createSpan = () => { throw new Error('A widget must not append to Document'); };
    try {
      const { parent } = fixture('@one/plan.md ');
      expect(parent.querySelector('.claudian-composer-file-name')?.textContent).toBe('plan');
    } finally {
      document.createSpan = original;
    }
  });

  it('keeps completion and deletion undoable without losing the full path', () => {
    const { input, view } = fixture('Review ');
    input.replaceText?.(7, 7, '@one/plan.md ');
    expect(input.value).toBe('Review @one/plan.md ');
    expect(undo(view)).toBe(true);
    expect(input.value).toBe('Review ');
    expect(redo(view)).toBe(true);
    input.setSelectionRange('Review @one/plan.md'.length, 'Review @one/plan.md'.length);
    const event = new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    expect(input.value).toBe('Review  ');
    expect(undo(view)).toBe(true);
    expect(input.value).toBe('Review @one/plan.md ');
  });

  it('exposes full source while editing a reference and renders its label again after leaving', () => {
    const { input, parent } = fixture('@notes/a plan.md ');
    expect(parent.querySelector('.claudian-composer-file-name')?.textContent).toBe('a plan');
    input.setSelectionRange(4, 4);
    expect(parent.querySelector('.claudian-composer-file')).toBeNull();
    input.setSelectionRange(input.value.length, input.value.length);
    expect(parent.querySelector('.claudian-composer-file-name')?.textContent).toBe('a plan');
  });

  it('routes keyboard choices to the owning input before applying editor defaults', () => {
    const { input, view } = fixture('@one');
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      input.replaceText?.(0, input.value.length, '@one/plan.md ');
    });
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    expect(input.value).toBe('@one/plan.md ');
  });

  it('leaves IME candidate keys to the native input method without routing chat or editor shortcuts', () => {
    const { input, view } = fixture('@one');
    const onKey = jest.fn();
    input.addEventListener('keydown', onKey);
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const key = new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, isComposing: true, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    expect(onKey).not.toHaveBeenCalled();
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });

  it('emits canonical input after a user edit and resets cleanly on a new draft', async () => {
    const { input, view, parent } = fixture('@one/plan.md ');
    const onInput = jest.fn(() => input.value);
    input.addEventListener('input', onInput);
    view.dispatch({ changes: { from: input.value.length, insert: 'Review' }, userEvent: 'input.type' });
    await Promise.resolve();
    expect(onInput).toHaveReturnedWith('@one/plan.md Review');
    input.value = '';
    expect(parent.querySelector('.claudian-composer-file')).toBeNull();
    expect(input.value).toBe('');
  });

  it('connects the real mention picker to the accessible textbox and an undoable completion', async () => {
    const { input, view, parent } = fixture('@one');
    const controller = new MentionDropdownController(parent, input, {
      getMentionedMcpServers: () => new Set(), setMentionedMcpServers: () => false,
      addMentionedMcpServer: jest.fn(), getExternalContexts: () => [], getCachedVaultFolders: () => [],
      getCachedVaultFiles: () => [{ path: 'one/plan.md', name: 'plan.md', stat: { mtime: 1 } }] as any,
      normalizePathForVault: path => path ?? null,
    });
    const onKey = (event: KeyboardEvent) => controller.handleKeydown(event);
    input.addEventListener('keydown', onKey);
    try {
      controller.handleInputChange();
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true }));
      expect(input.getAccessibleTextbox?.().hasAttribute('aria-controls')).toBe(true);
      expect(input.hasAttribute('aria-controls')).toBe(false);
      expect((await axe(parent)).violations).toEqual([]);
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
      expect(input.value).toBe('@one/plan.md ');
      expect(parent.querySelector('.claudian-composer-file-name')?.textContent).toBe('plan');
      expect(controller.isVisible()).toBe(false);
      expect(undo(view)).toBe(true);
      expect(input.value).toBe('@one');
    } finally {
      input.removeEventListener('keydown', onKey);
      controller.destroy();
    }
  });

  it('preserves canonical references across runtime draft detach and reattach', () => {
    const { input, app } = fixture('@one/plan.md ');
    const draft = new RuntimeComposer();
    const detach = draft.attach(input);
    expect(draft.value).toBe('@one/plan.md ');
    detach();
    const restored = new ComposerEditor(document.body.createDiv(), app);
    instances.push(restored);
    const detachRestored = draft.attach(restored.element);
    restored.element.focus();
    expect(restored.element.value).toBe('@one/plan.md ');
    expect(restored.element.getAccessibleTextbox?.().textContent).toContain('plan');
    detachRestored();
  });

  it('lets image attachment handling consume mixed clipboard data before text insertion', async () => {
    const { input, view, parent } = fixture('Review ');
    const file = new File(['image bytes'], 'paste.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(2) });
    const images = new ImageContextManager(parent, input, {}, undefined, { setItems: jest.fn(), clearItems: jest.fn() } as any);
    try {
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', { value: {
        items: [{ type: file.type, getAsFile: () => file }],
        getData: (type: string) => type === 'text/plain' ? 'clipboard image fallback' : '',
      } });
      view.contentDOM.dispatchEvent(paste);
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(images.getAttachedImages()).toEqual([expect.objectContaining({ name: 'paste.png', source: 'paste' })]);
      expect(input.value).toBe('Review ');
    } finally {
      images.destroy();
    }
  });

  it('routes file drops to attachments before the editor reads their contents as text', async () => {
    const { input, view, parent } = fixture('Review ');
    const wrapper = parent.createDiv({ cls: 'claudian-input-wrapper' });
    wrapper.append(input);
    const file = new File(['image bytes'], 'drop.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(2) });
    const images = new ImageContextManager(parent, input, {}, undefined, { setItems: jest.fn(), clearItems: jest.fn() } as any);
    const position = jest.spyOn(view, 'posAtCoords').mockReturnValue(7);
    try {
      const drop = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
      view.contentDOM.dispatchEvent(drop);
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(images.getAttachedImages()).toEqual([expect.objectContaining({ name: 'drop.png', source: 'drop' })]);
      expect(input.value).toBe('Review ');
      expect(position).not.toHaveBeenCalled();
    } finally {
      images.destroy();
      position.mockRestore();
    }
  });

  it('keeps a completed reference compact when its trailing space is removed', () => {
    const token = '@one/plan.md';
    const { input, parent } = fixture(`${token} `);
    input.replaceText?.(token.length, token.length + 1, '');
    expect(input.isChipRange?.(0, token.length)).toBe(true);
    expect(parent.querySelector('.claudian-composer-file-name')?.textContent).toBe('plan');
  });
});
