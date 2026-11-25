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

if (!Reflect.has(HTMLElement.prototype, 'appendText')) {
  HTMLElement.prototype.appendText = function appendText(this: HTMLElement, text: string): void {
    this.appendChild(this.ownerDocument.createTextNode(text));
  };
}

function render(lines: DiffLine[]): HTMLElement {
  const host = document.createElement('div');
  renderDiffContent(host, lines, 3);
  return host;
}

describe('DiffRenderer intra-line highlights', () => {
  it('marks one inserted CJK character and leaves the deleted line unmarked', () => {
    const host = render([
      { type: 'delete', text: '把 Coding Agent 提效改为 SpreadFun Harness', oldLineNum: 1 },
      { type: 'insert', text: '把 Coding Agent 提效改为 SpreadFun Harness。', newLineNum: 1 },
    ]);

    expect(host.querySelector('.claudian-diff-delete .claudian-diff-inline-delete')).toBeNull();
    expect(host.querySelector('.claudian-diff-insert .claudian-diff-inline-insert')?.textContent)
      .toBe('。');
    expect(host.querySelector('.claudian-diff-insert .claudian-diff-text')?.textContent)
      .toBe('把 Coding Agent 提效改为 SpreadFun Harness。');
  });

  it('highlights nothing when the replaced lines are unrelated', () => {
    const host = render([
      { type: 'delete', text: 'const old_value = compute(a, b);', oldLineNum: 1 },
      { type: 'insert', text: '完全不同的中文内容', newLineNum: 1 },
    ]);

    expect(host.querySelectorAll('.claudian-diff-inline-delete, .claudian-diff-inline-insert'))
      .toHaveLength(0);
  });
});
