/** @jest-environment jsdom */

import type { ToolCallInfo } from '@/core/types';
import { addSubagentToolCall, createSubagentBlock, updateSubagentToolResult } from '@/features/chat/rendering/SubagentRenderer';
import { refreshToolCallHeader, renderStoredToolCall, renderToolCall, updateToolCallResult } from '@/features/chat/rendering/ToolCallRenderer';

HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };
HTMLElement.prototype.setText = function setText(text: string): void { this.textContent = text; };

function call(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
  return { id: 'tool', name: 'Read', input: { file_path: 'notes/example.md' }, status: 'running', ...overrides };
}

describe('Tool row disclosures', () => {
  it('keeps refined result headers current through keyboard toggles without replacing the card', () => {
    const tools = new Map<string, HTMLElement>();
    const tool = call({ name: 'Bash', input: { command: 'echo before' } });
    const element = renderToolCall(document.createElement('div'), tool, tools);
    const header = element.querySelector<HTMLElement>('.claudian-tool-header')!;
    const updated = { ...tool, input: { command: 'echo after' }, status: 'completed' as const, result: 'Latest output' };

    updateToolCallResult(tool.id, updated, tools);

    expect(tools.get(tool.id)).toBe(element);
    expect(element.querySelector('.claudian-tool-summary')!.textContent).toContain('echo after');
    expect(header.getAttribute('aria-label')).toContain('echo after');
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(header.getAttribute('aria-label')).toContain('echo after');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(updated.isExpanded).toBe(true);
    expect(element.querySelector('.claudian-tool-content')!.textContent).toContain('Latest output');
    header.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(header.getAttribute('aria-label')).toContain('echo after');
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('updates file activation once when a rendered input refines its path', () => {
    const open = jest.fn();
    const tool = call();
    const element = renderToolCall(document.createElement('div'), tool, new Map(), { onOpenFile: open });
    const link = element.querySelector<HTMLElement>('.claudian-tool-summary')!;
    refreshToolCallHeader(element, { ...tool, input: { file_path: 'notes/after.md:12' } });
    refreshToolCallHeader(element, { ...tool, input: { file_path: 'notes/final.md:24' } });
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ path: 'notes/final.md', lineStart: 24, lineEnd: 24 });
    expect(link.getAttribute('title')).toBe('Open notes/final.md');
    expect(element.classList.contains('expanded')).toBe(false);
    expect(element.querySelector('.claudian-tool-header')!.hasAttribute('aria-label')).toBe(false);
  });

  it('applies the same disclosure policy to tools inside subagent results', () => {
    const state = createSubagentBlock(document.createElement('div'), 'agent', { description: 'Check files' });
    const tool = call();
    addSubagentToolCall(state, tool);
    const header = state.wrapperEl.querySelector<HTMLElement>('.claudian-subagent-tool-header')!;
    expect(header.hasAttribute('aria-expanded')).toBe(false);
    header.click();
    expect(header.parentElement!.classList.contains('expanded')).toBe(false);
    updateSubagentToolResult(state, tool.id, { ...tool, status: 'error', result: 'Denied' });
    header.click();
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it.each(['Read', 'Grep', 'Glob', 'LS', 'Skill'])('%s stays a summary during execution and replay', (name) => {
    for (const status of ['running', 'completed'] as const) {
      for (const stored of [false, true]) {
        const tool = call({ name, status, result: 'output' });
        const parent = document.createElement('div');
        const element = stored ? renderStoredToolCall(parent, tool) : renderToolCall(parent, tool, new Map());
        const header = element.querySelector<HTMLElement>('.claudian-tool-header')!;
        expect(header.hasAttribute('aria-expanded')).toBe(false);
        expect(header.hasAttribute('tabindex')).toBe(false);
        expect(header.getAttribute('role')).toBeNull();
        header.click();
        header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(element.classList.contains('expanded')).toBe(false);
      }
    }
  });

  it.each(['Read', 'Find', 'List'])('uses normalized presentation %s without provider-specific imports', (name) => {
    const element = renderStoredToolCall(document.createElement('div'), call({
      name: 'provider_native_tool', presentation: { name, summary: 'example.md' }, status: 'completed',
    }));
    expect(element.querySelector('.claudian-tool-header')!.hasAttribute('aria-expanded')).toBe(false);
  });

  it('keeps file activation independent from disclosure', () => {
    const open = jest.fn();
    const element = renderStoredToolCall(document.createElement('div'), call(), { onOpenFile: open });
    const link = element.querySelector<HTMLElement>('[role="link"]')!;
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(open).toHaveBeenCalledWith({ path: 'notes/example.md' });
    expect(element.classList.contains('expanded')).toBe(false);
  });

  it.each(['Bash', 'Edit', 'mcp__custom_tool'])('%s supports mouse and keyboard disclosure', (name) => {
    const element = renderStoredToolCall(document.createElement('div'), call({ name, status: 'completed', result: 'output' }));
    const header = element.querySelector<HTMLElement>('.claudian-tool-header')!;
    expect(header.getAttribute('aria-expanded')).toBe('false');
    header.click();
    expect(header.getAttribute('aria-expanded')).toBe('true');
    header.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('makes a failed Read inspectable when the live result arrives', () => {
    const tools = new Map<string, HTMLElement>();
    const tool = call();
    const element = renderToolCall(document.createElement('div'), tool, tools);
    tool.status = 'error'; tool.result = 'Permission denied';
    updateToolCallResult(tool.id, tool, tools);
    const header = element.querySelector<HTMLElement>('.claudian-tool-header')!;
    expect(header.getAttribute('aria-expanded')).toBe('false');
    header.click();
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelector('.claudian-tool-content')!.textContent).toContain('Permission denied');
  });

  it.each(['error', 'blocked'] as const)('keeps stored Read %s details accessible', (status) => {
    const element = renderStoredToolCall(document.createElement('div'), call({ status, result: 'Denied' }));
    const header = element.querySelector<HTMLElement>('.claudian-tool-header')!;
    header.click();
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });
});
