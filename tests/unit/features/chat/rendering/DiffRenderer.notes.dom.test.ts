/** @jest-environment jsdom */

import type { DiffLine } from '@/core/types/diff';
import { renderDiffContent } from '@/features/chat/rendering/DiffRenderer';

if (!Reflect.has(HTMLElement.prototype, 'empty')) {
  HTMLElement.prototype.empty = function empty(this: HTMLElement): void {
    this.replaceChildren();
  };
}

if (!Reflect.has(HTMLElement.prototype, 'setText')) {
  HTMLElement.prototype.setText = function setText(this: HTMLElement, text: string): void {
    this.textContent = text;
  };
}

if (!Reflect.has(HTMLElement.prototype, 'setCssProps')) {
  HTMLElement.prototype.setCssProps = function setCssProps(
    this: HTMLElement,
    props: Record<string, string>,
  ): void {
    for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value);
  };
}

const lines: DiffLine[] = [
  { type: 'equal', text: 'const a = 1;', oldLineNum: 10, newLineNum: 10 },
  { type: 'insert', text: 'const b = 2;', newLineNum: 11 },
  { type: 'delete', text: 'const c = 3;', oldLineNum: 12 },
];

function render(onAddNote: jest.Mock): HTMLElement {
  const host = document.createElement('div');
  renderDiffContent(host, lines, 3, { filePath: 'src/a.ts', onAddNote });
  return host;
}

describe('DiffRenderer review notes', () => {
  it('offers a note on changed and unchanged lines, never on a deleted line', () => {
    const host = render(jest.fn());

    expect(host.querySelectorAll('.claudian-diff-note-add')).toHaveLength(2);
    expect(host.querySelectorAll('.claudian-diff-note-draft')).toHaveLength(0);
    const button = host.querySelector<HTMLElement>('.claudian-diff-note-add')!;
    expect(button.getAttribute('title')).toBeNull();
    expect(button.getAttribute('data-tooltip-position')).toBe('top');
  });

  it('saves the draft on Enter with the line it was written on', () => {
    const onAddNote = jest.fn();
    const host = render(onAddNote);

    (host.querySelectorAll<HTMLElement>('.claudian-diff-note-add')[1]).click();
    const textarea = host.querySelector('textarea')!;
    textarea.value = 'Use the shared helper';
    textarea.dispatchEvent(new Event('input'));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));

    expect(onAddNote).toHaveBeenCalledWith({
      body: 'Use the shared helper',
      excerpt: 'const b = 2;',
      filePath: 'src/a.ts',
      id: 'src/a.ts:11',
      line: 11,
    });
    expect(host.querySelector('.claudian-diff-note-draft')).toBeNull();
  });

  it('keeps the draft on Shift+Enter and drops it on Escape', () => {
    const onAddNote = jest.fn();
    const host = render(onAddNote);

    (host.querySelectorAll<HTMLElement>('.claudian-diff-note-add')[1]).click();
    const textarea = host.querySelector('textarea')!;
    textarea.value = 'draft text';
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'Enter',
      shiftKey: true,
    }));

    expect(onAddNote).not.toHaveBeenCalled();
    expect(host.querySelector('.claudian-diff-note-draft')).not.toBeNull();

    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    expect(host.querySelector('.claudian-diff-note-draft')).toBeNull();
  });

  it('keeps save disabled until the draft has text', () => {
    const host = render(jest.fn());

    (host.querySelectorAll<HTMLElement>('.claudian-diff-note-add')[0]).click();
    const save = host.querySelector<HTMLButtonElement>('.claudian-diff-note-save')!;
    expect(save.disabled).toBe(true);

    const textarea = host.querySelector('textarea')!;
    textarea.value = 'note';
    textarea.dispatchEvent(new Event('input'));
    expect(save.disabled).toBe(false);
  });

  it('does not close a non-empty draft when another line is clicked', () => {
    const host = render(jest.fn());

    (host.querySelectorAll<HTMLElement>('.claudian-diff-note-add')[0]).click();
    const textarea = host.querySelector('textarea')!;
    textarea.value = 'keep me';
    (host.querySelectorAll<HTMLElement>('.claudian-diff-note-add')[1]).click();

    expect(host.querySelectorAll('.claudian-diff-note-draft')).toHaveLength(1);
    expect(host.querySelector('textarea')).toBe(textarea);
  });

  it('extends the open draft with Shift+click and saves a line range', () => {
    const onAddNote = jest.fn();
    const host = render(onAddNote);
    const buttons = host.querySelectorAll<HTMLElement>('.claudian-diff-note-add');

    buttons[0].click();
    const textarea = host.querySelector('textarea')!;
    textarea.value = 'both lines';
    buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));

    expect(host.querySelectorAll('.claudian-diff-note-range')).toHaveLength(2);

    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));

    expect(onAddNote).toHaveBeenCalledWith(expect.objectContaining({
      id: 'src/a.ts:10-11',
      line: 11,
      startLine: 10,
    }));
    expect(host.querySelectorAll('.claudian-diff-note-range')).toHaveLength(0);
  });
});
