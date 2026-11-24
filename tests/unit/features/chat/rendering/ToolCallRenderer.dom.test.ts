/** @jest-environment jsdom */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getByRole, queryByRole } from '@testing-library/dom';

import type { ToolCallInfo } from '@/core/types';
import { addSubagentToolCall, createSubagentBlock, updateSubagentToolResult } from '@/features/chat/rendering/SubagentRenderer';
import { refreshToolCallHeader, renderStoredToolCall, renderToolCall, updateToolCallResult } from '@/features/chat/rendering/ToolCallRenderer';

HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };
HTMLElement.prototype.setText = function setText(text: string): void { this.textContent = text; };

function call(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
  return { id: 'tool', name: 'Read', input: { file_path: 'notes/example.md' }, status: 'running', ...overrides };
}

describe('Tool row disclosures', () => {

  it('replaces a running status with an interrupted status in live and restored rows', () => {
    const parent = document.createElement('div');
    const elements = new Map<string, HTMLElement>();
    const tool = call({ name: 'sleep', input: {} });
    const live = renderToolCall(parent, tool, elements);
    expect(live.querySelector('.claudian-tool-status')?.textContent).toContain('running');
    tool.status = 'cancelled';
    updateToolCallResult(tool.id, tool, elements);
    expect(live.querySelector('.claudian-tool-status')?.textContent).toContain('Interrupted');
    expect(live.querySelector('.status-running')).toBeNull();
    const restored = renderStoredToolCall(parent, tool);
    expect(restored.querySelector('.claudian-tool-status')?.textContent).toContain('Interrupted');
  });

  it('keeps running tools free of ticking duration and captures timing on completion', () => {
    jest.useFakeTimers();
    jest.setSystemTime(100000);
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const tools = new Map<string, HTMLElement>();
    const tool = call({ startedAt: Date.now() });
    const element = renderToolCall(parent, tool, tools);
    expect(element.querySelector('.claudian-tool-status')?.textContent).toContain('running');
    jest.advanceTimersByTime(3000);
    expect(element.querySelector('.claudian-tool-duration')?.textContent).toBe('');
    jest.advanceTimersByTime(3000);
    expect(element.querySelector('.claudian-tool-duration')?.textContent).toBe('');
    tool.status = 'completed';
    tool.completedAt = Date.now();
    updateToolCallResult(tool.id, tool, tools);
    jest.advanceTimersByTime(2000);
    expect(element.querySelector('.claudian-tool-duration')?.textContent).toBe('6s');
    parent.remove();
    jest.useRealTimers();
  });

  it('shows the provider exit code footer for command rows', () => {
    const parent = document.createElement('div');
    const failed = renderStoredToolCall(parent, call({
      name: 'Bash',
      input: { command: 'missing-command' },
      status: 'error',
      result: 'command not found',
      exitCode: 127,
    }), { initiallyExpanded: true });
    expect(failed.querySelector('.claudian-tool-exit')?.textContent).toBe('Exit code 127');

    const succeeded = renderStoredToolCall(parent, call({
      name: 'Bash',
      input: { command: 'ls' },
      status: 'completed',
      result: 'notes',
      exitCode: 0,
    }), { initiallyExpanded: true });
    expect(succeeded.querySelector('.claudian-tool-exit')?.textContent).toBe('Success');
  });

  it('shows a command that reports file actions as one row', () => {
    const path = '平台方案/SpreadFun Harness/README.md';
    const query = '6 个\\|五个\\|第一轮只做\\|MR 周期\\|变更失败率';
    const row = renderStoredToolCall(document.createElement('div'), call({
      name: 'Bash', status: 'completed', input: { command: 'rg checklist' }, result: 'Original output', exitCode: 0,
      exploration: { reads: 2, searches: 1, actions: [
        { type: 'read', path }, { type: 'read', path },
        { type: 'search', query, path: 'README.md' },
      ] },
    }));
    const header = row.querySelector<HTMLElement>('.claudian-tool-header')!;
    expect(header.querySelectorAll('.claudian-tool-exploration-row')).toHaveLength(0);
    expect(header.textContent).toContain('rg checklist');
    header.click();
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(row.querySelector('.claudian-tool-content')?.textContent).toContain('Original output');
  });

  it.each(['stored', 'live'])('shows the full output on demand for a %s command', mode => {
    const parent = document.createElement('div');
    const calls = new Map<string, HTMLElement>();
    const result = [...Array.from({ length: 20 }, (_, index) => `line ${index + 1}`),
      '  21→ preserved output', '', 'final error detail'].join('\n');
    const tool = call({ name: 'Bash', input: { command: 'check' } });
    const row = mode === 'stored'
      ? renderStoredToolCall(parent, { ...tool, status: 'error', result, exitCode: 1 }, { initiallyExpanded: true })
      : renderToolCall(parent, tool, calls, { initiallyExpanded: true });
    if (mode === 'live') updateToolCallResult(tool.id, { ...tool, status: 'error', result, exitCode: 1 }, calls);

    const content = row.querySelector<HTMLElement>('.claudian-tool-content')!;
    const preview = content.querySelector<HTMLElement>('.claudian-tool-lines')!;
    const entry = getByRole(content, 'button', { name: 'View full output (23 lines)' });
    const full = content.querySelector('.claudian-tool-full-output')!;
    expect(entry.getAttribute('aria-expanded')).toBe('false');
    expect(entry.getAttribute('aria-controls')).toBe(full.id);
    expect(preview.querySelectorAll('.claudian-tool-line')).toHaveLength(20);
    expect(content.textContent).not.toContain('final error detail');

    entry.click();
    expect(getByRole(content, 'button', { name: 'Show preview' })).toBe(entry);
    expect(entry.getAttribute('aria-expanded')).toBe('true');
    expect(full.textContent).toBe(result);
    expect(full.classList.contains('claudian-hidden')).toBe(false);
    expect(preview.classList.contains('claudian-hidden')).toBe(true);
    expect(content.querySelector('.claudian-tool-exit')?.textContent).toBe('Exit code 1');
    expect(row.querySelector('.claudian-tool-header')?.getAttribute('aria-expanded')).toBe('true');

    entry.click();
    expect(entry.getAttribute('aria-expanded')).toBe('false');
    expect(preview.classList.contains('claudian-hidden')).toBe(false);
    expect(content.textContent).not.toContain('final error detail');
    expect(preview.querySelectorAll('.claudian-tool-line')).toHaveLength(20);
  });

  it('omits the full output control when the command fits in the preview', () => {
    const result = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n');
    const row = renderStoredToolCall(document.createElement('div'), call({
      name: 'Bash', input: { command: 'check' }, status: 'completed', result,
    }), { initiallyExpanded: true });
    expect(row.querySelectorAll('.claudian-tool-line')).toHaveLength(20);
    expect(queryByRole(row, 'button', { name: /^View full output/ })).toBeNull();
  });

  it('copies the command from a bash row and confirms it', async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const parent = document.createElement('div');
    const row = renderStoredToolCall(parent, call({
      name: 'Bash',
      input: { command: 'ls -la' },
      status: 'completed',
      result: 'notes',
    }), { initiallyExpanded: true });

    expect(row.querySelector('.claudian-tool-bash-command-text')?.textContent).toBe('$ ls -la');
    const button = row.querySelector<HTMLButtonElement>('.claudian-tool-copy-command');
    expect(button?.getAttribute('aria-label')).toBe('Copy command');
    expect(button?.getAttribute('data-tooltip-position')).toBe('top');
    button?.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('ls -la');
    expect(button?.getAttribute('aria-label')).toBe('Copied!');
    expect(button?.classList.contains('copied')).toBe(true);

    jest.advanceTimersByTime(1500);
    expect(button?.getAttribute('aria-label')).toBe('Copy command');
    expect(button?.classList.contains('copied')).toBe(false);
    jest.useRealTimers();
  });

  it('copies a command through the owner window after moving into a popout', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const secondary = frame.contentDocument!;
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const mainWrite = jest.fn().mockResolvedValue(undefined);
    const popoutWrite = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mainWrite } });
    Object.defineProperty(frame.contentWindow!.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: popoutWrite },
    });
    jest.spyOn(frame.contentWindow!, 'setTimeout').mockReturnValue(17);
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    try {
      const row = renderStoredToolCall(parent, call({
        name: 'Bash',
        input: { command: 'ls -la' },
        status: 'completed',
        result: 'notes',
      }), { initiallyExpanded: true });
      secondary.body.appendChild(secondary.adoptNode(parent));

      row.querySelector<HTMLButtonElement>('.claudian-tool-copy-command')!.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(popoutWrite).toHaveBeenCalledWith('ls -la');
      expect(mainWrite).not.toHaveBeenCalled();
    } finally {
      frame.remove();
      document.body.replaceChildren();
      if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('keeps the MCP icon when a friendly MCP label is used', () => {
    const parent = document.createElement('div');
    const element = renderStoredToolCall(parent, call({
      name: 'mcp__github__search_code',
      input: { query: 'Codex' },
      status: 'completed',
      presentation: { name: 'github', summary: 'search_code' },
    }));
    expect(element.querySelector('.claudian-tool-name')?.textContent).toBe('github');
    expect(element.querySelector('.claudian-tool-summary')?.textContent).toBe('search_code');
    expect(element.querySelector('.claudian-tool-icon svg title')?.textContent).toBe('MCP');
  });

  it('uses patch outcome labels instead of the generic blocked state', () => {
    const parent = document.createElement('div');
    const rejected = renderStoredToolCall(parent, call({
      name: 'apply_patch',
      input: { patch: '*** Begin Patch\n*** Update File: notes/a.md\n@@\n-old\n+new\n*** End Patch' },
      status: 'blocked',
    }));
    expect(rejected.querySelector('.claudian-tool-status')?.textContent).toBe('Rejected');

    const stopped = renderStoredToolCall(parent, call({
      name: 'apply_patch',
      input: { patch: '*** Begin Patch\n*** Update File: notes/a.md\n@@\n-old\n+new\n*** End Patch' },
      status: 'cancelled',
    }));
    expect(stopped.querySelector('.claudian-tool-status')?.textContent).toBe('Stopped');
  });

  it.each([
    ['observed second', { startedAt: 1000, completedAt: 2000 }, 'completed', '1s'],
    ['observed seconds', { startedAt: 1000, completedAt: 18000 }, 'completed', '17s'],
    ['recorded sub-millisecond', { durationMs: 0.009834 }, 'completed', '<1ms'],
    ['recorded milliseconds', { durationMs: 485.852875 }, 'completed', '486ms'],
    ['recorded zero', { durationMs: 0 }, 'completed', '0ms'],
    ['recorded failure', { durationMs: 62000 }, 'error', '1m 2s'],
  ] as const)('reveals %s timing only when the row is inspected', (_case, timing, status, expected) => {
    const style = document.head.appendChild(document.createElement('style'));
    style.textContent = readFileSync(path.resolve('src/style/components/toolcalls.css'), 'utf8');
    const parent = document.body.appendChild(document.createElement('div'));
    try {
      const completed = renderStoredToolCall(parent, call({
        name: 'Bash', input: { command: 'echo done' }, result: 'done',
        status, ...timing,
      }));
      const duration = completed.querySelector<HTMLElement>('.claudian-tool-duration')!;
      expect(duration.textContent).toBe(expected);
      expect(getComputedStyle(duration).display).toBe('none');
      const header = completed.querySelector<HTMLElement>('.claudian-tool-header')!;
      header.click();
      expect(getComputedStyle(duration).display).toBe('inline');
      header.click();
      expect(getComputedStyle(duration).display).toBe('none');
    } finally {
      style.remove();
      parent.remove();
    }
  });

  it('labels failures even when timing is unavailable', () => {
    const failed = renderStoredToolCall(document.createElement('div'), call({ status: 'error', result: 'Denied' }));
    expect(failed.querySelector('.claudian-tool-status')?.textContent).toBe('error');
    expect(failed.querySelector('.claudian-tool-duration')?.textContent).toBe('');
  });

  it('hides routine completion marks in the transcript activity surface', () => {
    const style = document.head.appendChild(document.createElement('style'));
    style.textContent = readFileSync(path.resolve('src/style/components/activity-rows.css'), 'utf8');
    const messages = document.body.appendChild(document.createElement('div'));
    messages.className = 'claudian-messages';
    try {
      const element = renderStoredToolCall(messages, call({ status: 'completed' }));
      expect(getComputedStyle(element.querySelector('.claudian-tool-status')!).display).toBe('none');
    } finally {
      style.remove();
      messages.remove();
    }
  });

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

  it('renders the latest collapsed subagent tool output on keyboard expansion', () => {
    const state = createSubagentBlock(document.createElement('div'), 'agent', { description: 'Check' });
    const tool = call({ name: 'Bash', input: { command: 'echo' } });
    addSubagentToolCall(state, tool);
    const header = state.wrapperEl.querySelector<HTMLElement>('.claudian-subagent-tool-header')!;
    const body = state.wrapperEl.querySelector<HTMLElement>('.claudian-subagent-tool-content')!;
    expect(body.childNodes).toHaveLength(0);
    updateSubagentToolResult(state, tool.id, { ...tool, status: 'completed', result: 'Newest output' });
    expect(body.childNodes).toHaveLength(0);
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(body.textContent).toContain('Newest output');
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
