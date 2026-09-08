import { createMockEl, type MockElement } from '@test/helpers/MockElement';
import { setIcon } from 'obsidian';

import type { SubagentInfo, ToolCallInfo } from '@/core/types';
import {
  addSubagentToolCall,
  createAsyncSubagentBlock,
  createSubagentBlock,
  finalizeAsyncSubagent,
  finalizeSubagentBlock,
  markAsyncSubagentOrphaned,
  renderStoredAsyncSubagent,
  renderStoredSubagent,
  updateAsyncSubagentRunning,
  updateSubagentToolResult,
} from '@/features/chat/rendering/SubagentRenderer';

const getTextByClass = (el: MockElement, cls: string): string[] => {
  const results: string[] = [];
  const visit = (node: MockElement) => {
    if (node.hasClass(cls)) {
      results.push(node.textContent);
    }
    node.children.forEach(visit);
  };
  visit(el);
  return results;
};

describe('Sync Subagent Renderer', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  describe('createSubagentBlock', () => {
    it('should start collapsed by default', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      expect(state.info.isExpanded).toBe(false);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(false);
    });

    it('should set aria-expanded to false by default', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      expect(state.headerEl.getAttribute('aria-expanded')).toBe('false');
    });

    it('should hide content by default', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      expect((state.contentEl as any).style.display).toBe('none');
    });

    it('should set correct ARIA attributes for accessibility', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      expect(state.headerEl.getAttribute('role')).toBe('button');
      expect(state.headerEl.getAttribute('tabindex')).toBe('0');
      expect(state.headerEl.getAttribute('aria-expanded')).toBe('false');
      expect(state.headerEl.getAttribute('aria-label')).toContain('click to expand');
    });

    it('should toggle expand/collapse on header click', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      // Initially collapsed
      expect(state.info.isExpanded).toBe(false);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(false);
      expect((state.contentEl as any).style.display).toBe('none');

      // Trigger click
      (state.headerEl as any).click();

      // Should be expanded
      expect(state.info.isExpanded).toBe(true);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(true);
      expect((state.contentEl as any).hasClass('claudian-hidden')).toBe(false);

      // Click again to collapse
      (state.headerEl as any).click();
      expect(state.info.isExpanded).toBe(false);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(false);
      expect((state.contentEl as any).style.display).toBe('none');
    });

    it('should update aria-expanded on toggle', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      // Initially collapsed
      expect(state.headerEl.getAttribute('aria-expanded')).toBe('false');

      // Expand
      (state.headerEl as any).click();
      expect(state.headerEl.getAttribute('aria-expanded')).toBe('true');

      // Collapse
      (state.headerEl as any).click();
      expect(state.headerEl.getAttribute('aria-expanded')).toBe('false');
    });

    it('should show description in label', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'My task description' });

      expect(state.labelEl.textContent).toBe('My task description');
    });

    it('should not show a tool count badge in the header', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      expect(getTextByClass(state.wrapperEl as any, 'claudian-subagent-count')).toEqual([]);
    });
  });

  describe('renderStoredSubagent', () => {
    it('should start collapsed by default', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
      };

      const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

      expect((wrapperEl as any).hasClass('expanded')).toBe(false);
    });

    it('should set aria-expanded to false by default', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
      };

      const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

      const headerEl = (wrapperEl as any).children[0];
      expect(headerEl.getAttribute('aria-expanded')).toBe('false');
    });

    it('should hide content by default', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
      };

      const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

      const contentEl = (wrapperEl as any).children[1];
      expect(contentEl.style.display).toBe('none');
    });

    it('should toggle expand/collapse on click', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
      };

      const wrapperEl = renderStoredSubagent(parentEl as any, subagent);
      const headerEl = (wrapperEl as any).children[0];
      const contentEl = (wrapperEl as any).children[1];

      // Initially collapsed
      expect((wrapperEl as any).hasClass('expanded')).toBe(false);
      expect(contentEl.style.display).toBe('none');

      // Click to expand
      headerEl.click();
      expect((wrapperEl as any).hasClass('expanded')).toBe(true);
      expect(contentEl.hasClass('claudian-hidden')).toBe(false);
      expect(headerEl.getAttribute('aria-expanded')).toBe('true');

      // Click to collapse
      headerEl.click();
      expect((wrapperEl as any).hasClass('expanded')).toBe(false);
      expect(contentEl.style.display).toBe('none');
      expect(headerEl.getAttribute('aria-expanded')).toBe('false');
    });
  });
});

describe('keyboard navigation', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  it('should support keyboard navigation (Enter/Space) on createSubagentBlock', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    // Simulate keydown event
    const keydownHandlers: Array<(e: any) => void> = [];
    const originalAddEventListener = state.headerEl.addEventListener;
    state.headerEl.addEventListener = (event: string, handler: (e: any) => void) => {
      if (event === 'keydown') {
        keydownHandlers.push(handler);
      }
      originalAddEventListener.call(state.headerEl, event, handler);
    };

    // Re-check - the handler should already be registered
    // We need to dispatch a keydown event
    const enterEvent = { key: 'Enter', preventDefault: jest.fn() };
    (state.headerEl as any).dispatchEvent({ type: 'keydown', ...enterEvent });

    // The handler should have been called and expanded
    expect(state.info.isExpanded).toBe(true);
    expect((state.wrapperEl as any).hasClass('expanded')).toBe(true);

    // Space to collapse
    const spaceEvent = { key: ' ', preventDefault: jest.fn() };
    (state.headerEl as any).dispatchEvent({ type: 'keydown', ...spaceEvent });

    expect(state.info.isExpanded).toBe(false);
    expect((state.wrapperEl as any).hasClass('expanded')).toBe(false);
  });

  it('should support keyboard navigation (Enter/Space) on renderStoredSubagent', () => {
    const subagent: SubagentInfo = {
      id: 'task-1',
      description: 'Test task',
      status: 'completed',
      toolCalls: [],
      isExpanded: false,
    };

    const wrapperEl = renderStoredSubagent(parentEl as any, subagent);
    const headerEl = (wrapperEl as any).children[0];

    // Simulate Enter key
    const enterEvent = { key: 'Enter', preventDefault: jest.fn() };
    headerEl.dispatchEvent({ type: 'keydown', ...enterEvent });

    expect((wrapperEl as any).hasClass('expanded')).toBe(true);

    // Simulate Space key to collapse
    const spaceEvent = { key: ' ', preventDefault: jest.fn() };
    headerEl.dispatchEvent({ type: 'keydown', ...spaceEvent });

    expect((wrapperEl as any).hasClass('expanded')).toBe(false);
  });
});

describe('Async Subagent Renderer', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  describe('inline display behavior', () => {
    it('should start collapsed', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      expect(state.info.isExpanded).toBe(false);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(false);
    });

    it('should have aria-label indicating expand action', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      expect(state.headerEl.getAttribute('aria-label')).toContain('click to expand');
    });

    it('should expand content when header is clicked', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      // Initially collapsed
      expect(state.info.isExpanded).toBe(false);

      // Trigger click to expand
      (state.headerEl as any).click();

      expect(state.info.isExpanded).toBe(true);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(true);
    });

    it('should toggle expansion on repeated clicks', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      // Click to expand
      (state.headerEl as any).click();
      expect(state.info.isExpanded).toBe(true);

      // Click to collapse
      (state.headerEl as any).click();
      expect(state.info.isExpanded).toBe(false);
    });

    it('should expand when Enter key is pressed', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-1', { description: 'Test' });

      const enterEvent = { key: 'Enter', preventDefault: jest.fn() };
      (state.headerEl as any).dispatchEvent({ type: 'keydown', ...enterEvent });

      expect(state.info.isExpanded).toBe(true);
    });

    it('should expand when Space key is pressed', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-1', { description: 'Test' });

      const spaceEvent = { key: ' ', preventDefault: jest.fn() };
      (state.headerEl as any).dispatchEvent({ type: 'keydown', ...spaceEvent });

      expect(state.info.isExpanded).toBe(true);
    });
  });

  it('shows label immediately and initializing status text', () => {
    const state = createAsyncSubagentBlock(parentEl as any, 'task-1', { description: 'Background job' });

    expect(state.labelEl.textContent).toBe('Background job');
    expect(state.statusTextEl.textContent).toBe('Initializing');
    expect((state.wrapperEl as any).getClasses()).toEqual(expect.arrayContaining(['async', 'pending']));
  });

  it('shows an animated running indicator icon while pending and running', () => {
    (setIcon as jest.Mock).mockClear();
    const state = createAsyncSubagentBlock(parentEl as any, 'task-spin', { description: 'Background job' });
    expect(setIcon).toHaveBeenCalledWith(state.statusEl, 'loader-2');

    (setIcon as jest.Mock).mockClear();
    updateAsyncSubagentRunning(state, 'agent-spin');
    expect(setIcon).toHaveBeenCalledWith(state.statusEl, 'loader-2');
    expect(state.statusEl.className).toContain('status-running');
    expect(state.statusEl.getAttribute('aria-label')).toBe('Status: running');
  });

  it('shows prompt in content and keeps label visible while running', () => {
    const state = createAsyncSubagentBlock(parentEl as any, 'task-2', { description: 'Background job', prompt: 'Do the work' });

    updateAsyncSubagentRunning(state, 'agent-xyz');

    expect(state.labelEl.textContent).toBe('Background job');
    expect(state.statusTextEl.textContent).toBe('Running in background');
    const contentText = getTextByClass(state.contentEl as any, 'claudian-subagent-prompt-text')[0];
    expect(contentText).toContain('Do the work');
    expect((state.wrapperEl as any).getClasses()).toEqual(expect.arrayContaining(['running', 'async']));
  });

  it('finalizes to completed and reveals description', () => {
    const state = createAsyncSubagentBlock(parentEl as any, 'task-3', { description: 'Background job' });
    state.info.toolCalls.push(
      {
        id: 'tool-1',
        name: 'Read',
        input: { file_path: 'a.md' },
        status: 'completed',
        result: 'A',
        isExpanded: false,
      },
      {
        id: 'tool-2',
        name: 'Grep',
        input: { pattern: 'x' },
        status: 'completed',
        result: 'B',
        isExpanded: false,
      }
    );
    updateAsyncSubagentRunning(state, 'agent-complete');

    (setIcon as jest.Mock).mockClear();
    finalizeAsyncSubagent(state, 'all done', false);

    expect(state.labelEl.textContent).toBe('Background job');
    expect(state.statusTextEl.textContent).toBe('Completed');
    expect((state.wrapperEl as any).hasClass('done')).toBe(true);
    const contentText = getTextByClass(state.contentEl as any, 'claudian-subagent-result-output')[0];
    expect(contentText).toBe('all done');
    const lastIcon = (setIcon as jest.Mock).mock.calls.pop();
    expect(lastIcon?.[1]).toBe('check');
  });

  it('finalizes to error and truncates error message', () => {
    const state = createAsyncSubagentBlock(parentEl as any, 'task-4', { description: 'Background job' });
    updateAsyncSubagentRunning(state, 'agent-error');

    (setIcon as jest.Mock).mockClear();
    finalizeAsyncSubagent(state, 'failure happened', true);

    expect(state.statusTextEl.textContent).toBe('Error');
    expect((state.wrapperEl as any).hasClass('error')).toBe(true);
    const contentText = getTextByClass(state.contentEl as any, 'claudian-subagent-result-output')[0];
    expect(contentText).toBe('failure happened');
    const lastIcon = (setIcon as jest.Mock).mock.calls.pop();
    expect(lastIcon?.[1]).toBe('x');
  });

  it('marks async subagent as orphaned', () => {
    const state = createAsyncSubagentBlock(parentEl as any, 'task-5', { description: 'Background job' });

    markAsyncSubagentOrphaned(state);

    expect(state.statusTextEl.textContent).toBe('Orphaned');
    expect((state.wrapperEl as any).hasClass('orphaned')).toBe(true);
    const contentText = getTextByClass(state.contentEl as any, 'claudian-subagent-result-output')[0];
    expect(contentText).toContain('Conversation ended before task completed');
  });

  describe('idempotent incremental content (no rebuild on repeat publishes)', () => {
    const makeToolCalls = (): ToolCallInfo[] => [
      {
        id: 'tool-a',
        name: 'Read',
        input: { file_path: 'a.md' },
        status: 'completed',
        result: 'A',
        isExpanded: false,
      },
      {
        id: 'tool-b',
        name: 'Grep',
        input: { pattern: 'x' },
        status: 'completed',
        result: 'B',
        isExpanded: false,
      },
    ];

    it('keeps tool item DOM nodes stable across repeated running updates', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-rep-run', { description: 'Bg', prompt: 'P' });
      state.info.toolCalls.push(...makeToolCalls());

      updateAsyncSubagentRunning(state, 'agent-rep-run');
      const toolsBefore = (state.contentEl as any).querySelectorAll('.claudian-subagent-tool-item');
      const promptBefore = (state.contentEl as any).querySelector('.claudian-subagent-prompt-text');
      expect(toolsBefore).toHaveLength(2);

      // Second publish with identical content must not rebuild the DOM.
      updateAsyncSubagentRunning(state, 'agent-rep-run');
      const toolsAfter = (state.contentEl as any).querySelectorAll('.claudian-subagent-tool-item');
      const promptAfter = (state.contentEl as any).querySelector('.claudian-subagent-prompt-text');

      expect(toolsAfter).toHaveLength(2);
      expect(toolsAfter[0]).toBe(toolsBefore[0]);
      expect(toolsAfter[1]).toBe(toolsBefore[1]);
      expect(promptAfter).toBe(promptBefore);
    });

    it('does not detach or duplicate tool/result DOM when finalize is published repeatedly', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-rep-final', { description: 'Bg', prompt: 'P' });
      updateAsyncSubagentRunning(state, 'agent-rep-final');
      state.info.toolCalls.push(...makeToolCalls());

      finalizeAsyncSubagent(state, 'first result', false);
      const toolsBefore = (state.contentEl as any).querySelectorAll('.claudian-subagent-tool-item');
      const resultBefore = (state.contentEl as any).querySelector('.claudian-subagent-result-output');
      const sectionsBefore = (state.contentEl as any).querySelectorAll('.claudian-subagent-section');
      expect(toolsBefore).toHaveLength(2);
      expect(resultBefore.textContent).toBe('first result');

      // Duplicate terminal publishes (notification + tool_output + hydration refresh).
      finalizeAsyncSubagent(state, 'first result', false);
      finalizeAsyncSubagent(state, 'first result', false);

      const toolsAfter = (state.contentEl as any).querySelectorAll('.claudian-subagent-tool-item');
      const resultAfter = (state.contentEl as any).querySelector('.claudian-subagent-result-output');
      const sectionsAfter = (state.contentEl as any).querySelectorAll('.claudian-subagent-section');

      expect(toolsAfter).toHaveLength(2);
      expect(toolsAfter[0]).toBe(toolsBefore[0]);
      expect(toolsAfter[1]).toBe(toolsBefore[1]);
      expect(resultAfter).toBe(resultBefore);
      expect(resultAfter.textContent).toBe('first result');
      expect(sectionsAfter).toHaveLength(sectionsBefore.length);
    });

    it('appends newly hydrated tool calls without rebuilding prior result DOM', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-hydrate', { description: 'Bg', prompt: 'P' });
      updateAsyncSubagentRunning(state, 'agent-hydrate');

      // Terminal publish arrives before tool calls have been hydrated.
      finalizeAsyncSubagent(state, 'done', false);
      const resultBefore = (state.contentEl as any).querySelector('.claudian-subagent-result-output');
      const promptBefore = (state.contentEl as any).querySelector('.claudian-subagent-prompt-text');
      expect(resultBefore.textContent).toBe('done');
      expect((state.contentEl as any).querySelectorAll('.claudian-subagent-tool-item')).toHaveLength(0);

      // Hydration adds tool calls and triggers a refresh publish.
      state.info.toolCalls.push(...makeToolCalls());
      finalizeAsyncSubagent(state, 'done', false);

      const toolsAfter = (state.contentEl as any).querySelectorAll('.claudian-subagent-tool-item');
      const resultAfter = (state.contentEl as any).querySelector('.claudian-subagent-result-output');
      expect(toolsAfter).toHaveLength(2);
      expect(resultAfter).toBe(resultBefore);
      expect((state.contentEl as any).querySelector('.claudian-subagent-prompt-text')).toBe(promptBefore);
      expect(resultAfter.textContent).toBe('done');
    });

    it('updates the result text in place when a later refresh publishes richer content', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-rich', { description: 'Bg', prompt: 'P' });
      updateAsyncSubagentRunning(state, 'agent-rich');

      finalizeAsyncSubagent(state, 'DONE', false);
      const resultBefore = (state.contentEl as any).querySelector('.claudian-subagent-result-output');

      finalizeAsyncSubagent(state, 'full hydrated result text', false);

      const resultAfter = (state.contentEl as any).querySelector('.claudian-subagent-result-output');
      expect(resultAfter).toBe(resultBefore);
      expect((state.contentEl as any).querySelectorAll('.claudian-subagent-result-output')).toHaveLength(1);
      expect(resultAfter.textContent).toBe('full hydrated result text');
    });
  });

  describe('open transcript entry (live cards)', () => {
    it('adds an open button once the agent id is known', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-open', { description: 'Transcribe me' });

      // Pending state has no agent id yet, so no entry button.
      expect(state.openTranscriptBtnEl).toBeUndefined();
      expect((state.wrapperEl as any).querySelector('.claudian-subagent-open-transcript')).toBeNull();

      updateAsyncSubagentRunning(state, 'agent-open');

      expect(state.openTranscriptBtnEl).toBeTruthy();
      const btn = (state.wrapperEl as any).querySelector('.claudian-subagent-open-transcript');
      expect(btn).toBe(state.openTranscriptBtnEl);
      expect(btn.getAttribute('aria-label')).toContain('Open full conversation of Transcribe me');
    });

    it('does not toggle collapse when the open button is clicked', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-open', { description: 'Transcribe me' });
      updateAsyncSubagentRunning(state, 'agent-open');
      const btn = (state.wrapperEl as any).querySelector('.claudian-subagent-open-transcript');

      btn.click();

      expect(state.info.isExpanded).toBe(false);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(false);
    });

    it('dispatches a bubbling open event with task id and agent id', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-open', { description: 'Transcribe me' });
      updateAsyncSubagentRunning(state, 'agent-open');

      const listener = jest.fn();
      (state.wrapperEl as any).addEventListener('claudian:open-subagent-transcript', listener);
      const btn = (state.wrapperEl as any).querySelector('.claudian-subagent-open-transcript');

      btn.click();

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0];
      expect(event.type).toBe('claudian:open-subagent-transcript');
      expect(event.detail).toEqual({
        taskToolId: 'task-open',
        agentId: 'agent-open',
        description: 'Transcribe me',
        status: 'running',
      });
    });

    it('keeps the entry button through finalize and does not duplicate it', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-open', { description: 'Transcribe me' });
      updateAsyncSubagentRunning(state, 'agent-open');
      finalizeAsyncSubagent(state, 'done', false);

      const buttons = (state.wrapperEl as any).querySelectorAll('.claudian-subagent-open-transcript');
      expect(buttons).toHaveLength(1);
      expect(state.openTranscriptBtnEl).toBeTruthy();
    });
  });

  describe('renderStoredAsyncSubagent', () => {
    it('adds an open entry button when the stored agent id is known', () => {
      const subagent: SubagentInfo = {
        id: 'task-stored',
        description: 'Stored task',
        status: 'completed',
        agentId: 'agent-stored',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'completed',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);
      const btn = (wrapperEl as any).querySelector('.claudian-subagent-open-transcript');

      expect(btn).toBeTruthy();
      expect(btn.getAttribute('aria-label')).toContain('Open full conversation of Stored task');
    });

    it('omits the open entry button when no stored agent id exists', () => {
      const subagent: SubagentInfo = {
        id: 'task-stored',
        description: 'Stored task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'completed',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);
      expect((wrapperEl as any).querySelector('.claudian-subagent-open-transcript')).toBeNull();
    });

    it('should return wrapper element', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'completed',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);

      expect(wrapperEl).toBeDefined();
      expect((wrapperEl as any).hasClass('claudian-subagent-list')).toBe(true);
    });

    it('should expand content when header is clicked', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'completed',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);
      const headerEl = (wrapperEl as any).children[0];

      // Click to expand
      headerEl.click();

      expect((wrapperEl as any).hasClass('expanded')).toBe(true);
    });

    it('should expand on Enter key', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'completed',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);
      const headerEl = (wrapperEl as any).children[0];

      const enterEvent = { key: 'Enter', preventDefault: jest.fn() };
      headerEl.dispatchEvent({ type: 'keydown', ...enterEvent });

      expect((wrapperEl as any).hasClass('expanded')).toBe(true);
    });

    it('should have aria-label indicating expand action', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'completed',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);
      const headerEl = (wrapperEl as any).children[0];

      expect(headerEl.getAttribute('aria-label')).toContain('click to expand');
    });

    it('should toggle expansion on repeated clicks', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'completed',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);
      const headerEl = (wrapperEl as any).children[0];

      // Click to expand
      headerEl.click();
      expect((wrapperEl as any).hasClass('expanded')).toBe(true);

      // Click to collapse
      headerEl.click();
      expect((wrapperEl as any).hasClass('expanded')).toBe(false);
    });

    it('renders error status correctly', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Failed task',
        status: 'error',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'error',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);

      expect((wrapperEl as any).hasClass('error')).toBe(true);
      const contentText = getTextByClass(wrapperEl as any, 'claudian-subagent-result-output')[0];
      expect(contentText).toBe('ERROR');
    });

    it('renders orphaned status correctly', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Lost task',
        status: 'error',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'orphaned',
      };

      (setIcon as jest.Mock).mockClear();
      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);

      expect((wrapperEl as any).hasClass('error')).toBe(true);
      expect((wrapperEl as any).hasClass('orphaned')).toBe(true);
      const contentText = getTextByClass(wrapperEl as any, 'claudian-subagent-result-output')[0];
      expect(contentText).toContain('Conversation ended before task completed');
      // Should use alert-circle icon
      expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'alert-circle');
    });

    it('renders running status with prompt', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Running task',
        status: 'running',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'running',
        prompt: 'Do some work',
      };

      (setIcon as jest.Mock).mockClear();
      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);

      expect((wrapperEl as any).hasClass('running')).toBe(true);
      const contentText = getTextByClass(wrapperEl as any, 'claudian-subagent-prompt-text')[0];
      expect(contentText).toContain('Do some work');
      // Running cards keep an animated indicator icon
      expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'loader-2');
    });

    it('renders pending status as running', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Pending task',
        status: 'running',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'pending',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);

      // pending maps to running display status
      expect((wrapperEl as any).hasClass('running')).toBe(true);
    });
  });
});

describe('addSubagentToolCall', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  it('adds tool call to state without rendering a header count', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    const toolCall: ToolCallInfo = {
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'test.md' },
      status: 'running',
      isExpanded: false,
    };

    addSubagentToolCall(state, toolCall);

    expect(state.info.toolCalls).toHaveLength(1);
    expect(getTextByClass(state.wrapperEl as any, 'claudian-subagent-count')).toEqual([]);
  });

  it('opens a Read file reference without expanding the subagent tool card', () => {
    const onOpenFile = jest.fn();
    const state = createSubagentBlock(
      parentEl as any,
      'task-1',
      { description: 'Test task' },
      { onOpenFile },
    );
    const toolCall: ToolCallInfo = {
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'notes/file.md:140-185' },
      status: 'running',
      isExpanded: false,
    };

    addSubagentToolCall(state, toolCall);
    (state.wrapperEl.querySelector('.claudian-subagent-tool-summary') as HTMLElement).click();

    expect(onOpenFile).toHaveBeenCalledWith({
      path: 'notes/file.md',
      lineStart: 140,
      lineEnd: 185,
    });
    expect(toolCall.isExpanded).toBe(false);
  });

  it('clears previous content and renders new tool item', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    const toolCall1: ToolCallInfo = {
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'test.md' },
      status: 'running',
      isExpanded: false,
    };
    addSubagentToolCall(state, toolCall1);

    const toolCall2: ToolCallInfo = {
      id: 'tool-2',
      name: 'Grep',
      input: { pattern: 'test' },
      status: 'running',
      isExpanded: false,
    };
    addSubagentToolCall(state, toolCall2);

    expect(state.info.toolCalls).toHaveLength(2);
    expect(getTextByClass(state.wrapperEl as any, 'claudian-subagent-count')).toEqual([]);
  });

  it('merges repeated tool IDs instead of duplicating tool rows', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    addSubagentToolCall(state, {
      id: 'tool-1',
      name: 'Write',
      input: {},
      status: 'running',
      isExpanded: false,
    });

    addSubagentToolCall(state, {
      id: 'tool-1',
      name: 'Write',
      input: { file_path: 'notes.md' },
      status: 'running',
      isExpanded: false,
    });

    expect(state.info.toolCalls).toHaveLength(1);
    expect(state.info.toolCalls[0]).toEqual(
      expect.objectContaining({
        id: 'tool-1',
        input: { file_path: 'notes.md' },
      })
    );
    expect(getTextByClass(state.wrapperEl as any, 'claudian-subagent-count')).toEqual([]);
    expect(getTextByClass(state.toolsContainerEl as any, 'claudian-subagent-tool-name')).toEqual(['Write']);
    expect(getTextByClass(state.toolsContainerEl as any, 'claudian-subagent-tool-summary')).toEqual(['notes.md']);
  });
});

describe('updateSubagentToolResult', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  it('updates tool call status in state', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    const toolCall: ToolCallInfo = {
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'test.md' },
      status: 'running',
      isExpanded: false,
    };
    addSubagentToolCall(state, toolCall);

    const updatedToolCall: ToolCallInfo = {
      ...toolCall,
      status: 'completed',
      result: 'File contents here',
    };
    updateSubagentToolResult(state, 'tool-1', updatedToolCall);

    expect(state.info.toolCalls[0].status).toBe('completed');
  });

  it('does not update tool call for non-matching tool ID', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    const toolCall: ToolCallInfo = {
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'test.md' },
      status: 'running',
      isExpanded: false,
    };
    addSubagentToolCall(state, toolCall);

    updateSubagentToolResult(state, 'tool-999', { ...toolCall, id: 'tool-999', status: 'completed' });

    expect(state.info.toolCalls[0].status).toBe('running');
  });
});

describe('finalizeSubagentBlock', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  it('sets status to completed and adds done class', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    (setIcon as jest.Mock).mockClear();
    finalizeSubagentBlock(state, 'All done', false);

    expect(state.info.status).toBe('completed');
    expect(state.info.result).toBe('All done');
    expect((state.wrapperEl as any).hasClass('done')).toBe(true);
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'check');
  });

  it('sets status to error and adds error class', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    (setIcon as jest.Mock).mockClear();
    finalizeSubagentBlock(state, 'Something failed', true);

    expect(state.info.status).toBe('error');
    expect(state.info.result).toBe('Something failed');
    expect((state.wrapperEl as any).hasClass('error')).toBe(true);
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'x');
  });

  it('keeps tool history and shows result section text', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    // Add a tool call first to populate content
    addSubagentToolCall(state, {
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'test.md' },
      status: 'running',
      isExpanded: false,
    });

    finalizeSubagentBlock(state, 'Done', false);

    const doneText = getTextByClass(state.contentEl as any, 'claudian-subagent-result-output')[0];
    expect(doneText).toBe('Done');
  });

  it('adds a concise result summary to the collapsed header', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    finalizeSubagentBlock(
      state,
      'Implemented the requested behavior and added regression coverage. Full details follow.',
      false,
    );

    const summary = getTextByClass(state.wrapperEl as any, 'claudian-subagent-result-summary')[0];
    expect(summary).toBe('Implemented the requested behavior and added regression coverage. Full details follow.');
    const summaryEl = state.wrapperEl.querySelector('.claudian-subagent-result-summary') as HTMLElement;
    expect(summaryEl.getAttribute('title')).toBe(summaryEl.textContent);
    expect(getTextByClass(state.wrapperEl as any, 'claudian-subagent-status-text')[0])
      .toBe('Completed');
  });

  it('does not retain a full result in the header tooltip', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });
    const result = `Completed: ${'detail '.repeat(10_000)}`;

    finalizeSubagentBlock(state, result, false);

    const summaryEl = state.wrapperEl.querySelector('.claudian-subagent-result-summary') as HTMLElement;
    expect(summaryEl.textContent).toHaveLength(120);
    expect(summaryEl.getAttribute('title')).toBe(summaryEl.textContent);
  });

  it('shows ERROR text when isError is true', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    finalizeSubagentBlock(state, 'Error occurred', true);

    const errorText = getTextByClass(state.contentEl as any, 'claudian-subagent-result-output')[0];
    expect(errorText).toBe('Error occurred');
  });

  it('does not restore a tool count badge after finalization', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    addSubagentToolCall(state, {
      id: 'tool-1',
      name: 'Read',
      input: {},
      status: 'running',
      isExpanded: false,
    });
    addSubagentToolCall(state, {
      id: 'tool-2',
      name: 'Grep',
      input: {},
      status: 'running',
      isExpanded: false,
    });

    finalizeSubagentBlock(state, 'Done', false);

    expect(getTextByClass(state.wrapperEl as any, 'claudian-subagent-count')).toEqual([]);
  });
});

describe('renderStoredSubagent status variants', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  it('renders completed subagent with done class and check icon', () => {
    const subagent: SubagentInfo = {
      id: 'task-1',
      description: 'Completed task',
      status: 'completed',
      toolCalls: [],
      isExpanded: false,
    };

    (setIcon as jest.Mock).mockClear();
    const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

    expect((wrapperEl as any).hasClass('done')).toBe(true);
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'check');
    const doneText = getTextByClass(wrapperEl as any, 'claudian-subagent-result-output')[0];
    expect(doneText).toBe('DONE');
  });

  it('renders error subagent with error class and x icon', () => {
    const subagent: SubagentInfo = {
      id: 'task-1',
      description: 'Failed task',
      status: 'error',
      toolCalls: [],
      isExpanded: false,
    };

    (setIcon as jest.Mock).mockClear();
    const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

    expect((wrapperEl as any).hasClass('error')).toBe(true);
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'x');
    const errorText = getTextByClass(wrapperEl as any, 'claudian-subagent-result-output')[0];
    expect(errorText).toBe('ERROR');
  });

  it('renders running subagent with tool list', () => {
    const subagent: SubagentInfo = {
      id: 'task-1',
      description: 'Running task',
      status: 'running',
      toolCalls: [
        { id: 'tool-1', name: 'Read', input: { file_path: 'test.md' }, status: 'completed', isExpanded: false },
        { id: 'tool-2', name: 'Grep', input: { pattern: 'test' }, status: 'running', isExpanded: false },
      ],
      isExpanded: false,
    };

    const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

    // Should not have done or error class
    expect((wrapperEl as any).hasClass('done')).toBe(false);
    expect((wrapperEl as any).hasClass('error')).toBe(false);
  });

  it('renders running subagent tool call with expanded-style result', () => {
    const subagent: SubagentInfo = {
      id: 'task-1',
      description: 'Running task',
      status: 'running',
      toolCalls: [
        {
          id: 'tool-1',
          name: 'Read',
          input: { file_path: 'test.md' },
          status: 'completed',
          result: 'File contents here',
          isExpanded: false,
        },
      ],
      isExpanded: false,
    };

    const wrapperEl = renderStoredSubagent(parentEl as any, subagent);
    const contentEl = (wrapperEl as any).children[1]; // content area

    // Should show result text
    const resultTexts = getTextByClass(contentEl, 'claudian-tool-line');
    expect(resultTexts.length).toBe(1);
    expect(resultTexts[0]).toContain('File contents here');
  });

  it('does not render a tool count badge for stored subagents', () => {
    const subagent: SubagentInfo = {
      id: 'task-1',
      description: 'Task with tools',
      status: 'completed',
      toolCalls: [
        { id: 'tool-1', name: 'Read', input: {}, status: 'completed', isExpanded: false },
        { id: 'tool-2', name: 'Grep', input: {}, status: 'completed', isExpanded: false },
        { id: 'tool-3', name: 'Edit', input: {}, status: 'completed', isExpanded: false },
      ],
      isExpanded: false,
    };

    const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

    expect(getTextByClass(wrapperEl as any, 'claudian-subagent-count')).toEqual([]);
  });

  it('truncates long descriptions', () => {
    const longDesc = 'A'.repeat(50);
    const subagent: SubagentInfo = {
      id: 'task-1',
      description: longDesc,
      status: 'completed',
      toolCalls: [],
      isExpanded: false,
    };

    const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

    const labelTexts = getTextByClass(wrapperEl as any, 'claudian-subagent-label');
    expect(labelTexts[0]).toBe('A'.repeat(40) + '...');
  });
});
