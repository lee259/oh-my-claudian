/** @jest-environment jsdom */

import type { ToolCallInfo } from '@/core/types';
import { createWriteEditBlock } from '@/features/chat/rendering/WriteEditRenderer';

HTMLElement.prototype.empty = function (): void { this.replaceChildren(); };
HTMLElement.prototype.setText = function (text: string): void { this.textContent = text; };

it.each(['Write', 'Edit'])('refreshes a %s file link without changing pending output or disclosure state', (name) => {
  const open = jest.fn();
  const tool: ToolCallInfo = { id: 'file', name, input: { file_path: 'before.md' }, status: 'running' };
  const state = createWriteEditBlock(document.createElement('div'), tool, { onOpenFile: open });
  state.headerEl.click();
  const content = state.contentEl.innerHTML;

  tool.input = { file_path: 'after.md:12-14' };
  state.refreshHeader();
  state.refreshHeader();
  state.summaryEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith({ path: 'after.md', lineStart: 12, lineEnd: 14 });
  expect(state.summaryEl.textContent).toBe('after.md:12-14');
  expect(state.headerEl.getAttribute('aria-label')).toContain('after.md:12-14');
  expect(state.headerEl.getAttribute('aria-expanded')).toBe('true');
  expect(state.contentEl.innerHTML).toBe(content);
  expect(tool.status).toBe('running');
  state.headerEl.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  expect(state.headerEl.getAttribute('aria-label')).toContain('after.md:12-14');
  expect(state.headerEl.getAttribute('aria-expanded')).toBe('false');
});
