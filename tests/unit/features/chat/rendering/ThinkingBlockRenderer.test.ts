import { createMockEl } from '@test/helpers/MockElement';

import {
  appendThinkingContent,
  createThinkingBlock,
  finalizeThinkingBlock,
  renderStoredThinkingBlock,
} from '@/features/chat/rendering/ThinkingBlockRenderer';

// Mock renderContent function
const mockRenderContent = jest.fn().mockResolvedValue(undefined);

describe('ThinkingBlockRenderer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createThinkingBlock', () => {
    it('should show timer label', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl);

      expect(state.labelEl.textContent).toContain('Thinking');
    });

    it('should clean up timer on finalize', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl);

      expect(state.timerInterval).not.toBeNull();

      finalizeThinkingBlock(state);

      expect(state.timerInterval).toBeNull();
    });

    it('reports expansion state without rendering content itself', () => {
      const parentEl = createMockEl();
      const onToggle = jest.fn();
      const state = createThinkingBlock(parentEl, { onToggle });
      const header = (state.wrapperEl as any)._children[0];
      const clickHandlers = header._eventListeners.get('click') || [];

      clickHandlers[0]();
      clickHandlers[0]();

      expect(onToggle).toHaveBeenNthCalledWith(1, true);
      expect(onToggle).toHaveBeenNthCalledWith(2, false);
      expect(mockRenderContent).not.toHaveBeenCalled();
    });
  });

  describe('finalizeThinkingBlock', () => {
    it('should collapse the block when finalized', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl);

      // Manually expand first
      state.wrapperEl.addClass('expanded');
      state.contentEl.style.display = 'block';

      finalizeThinkingBlock(state);

      expect(state.wrapperEl.hasClass('expanded')).toBe(false);
      expect(state.contentEl.style.display).toBe('none');
    });

    it('should summarize the first paragraph after reasoning settles', async () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl);
      await appendThinkingContent(
        state,
        'I will inspect the vault structure.\n\nThe full reasoning stays in the expandable details.',
        mockRenderContent,
      );

      // Advance time by 5 seconds
      jest.advanceTimersByTime(5000);

      const duration = finalizeThinkingBlock(state);

      expect(duration).toBeGreaterThanOrEqual(5);
      expect(state.labelEl.textContent).toBe('I will inspect the vault structure.');
      expect(state.labelEl.textContent).not.toContain('full reasoning');
    });

    it('should sync isExpanded state so toggle works correctly after finalize', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl);
      const header = (state.wrapperEl as any)._children[0];

      // Expand the block
      const clickHandlers = header._eventListeners.get('click') || [];
      clickHandlers[0]();
      expect(state.isExpanded).toBe(true);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(true);

      // Finalize (which collapses)
      finalizeThinkingBlock(state);
      expect(state.isExpanded).toBe(false);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(false);

      // Now click once - should expand (not require two clicks)
      clickHandlers[0]();
      expect(state.isExpanded).toBe(true);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(true);
      expect((state.contentEl as any).hasClass('claudian-hidden')).toBe(false);
    });

    it('should update aria-expanded on finalize', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl);
      const header = (state.wrapperEl as any)._children[0];

      // Expand first
      const clickHandlers = header._eventListeners.get('click') || [];
      clickHandlers[0]();
      expect(header.getAttribute('aria-expanded')).toBe('true');

      // Finalize
      finalizeThinkingBlock(state);
      expect(header.getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('renderStoredThinkingBlock', () => {
    it('should render a first-paragraph summary and keep full reasoning collapsed', () => {
      const parentEl = createMockEl();

      const wrapperEl = renderStoredThinkingBlock(
        parentEl,
        'I will inspect the vault structure.\n\nThe full reasoning stays in the expandable details.',
        10,
        mockRenderContent,
      );

      expect(wrapperEl.querySelector('.claudian-thinking-label')?.textContent)
        .toBe('I will inspect the vault structure.');
      expect(wrapperEl.querySelector('.claudian-thinking-header')?.getAttribute('aria-expanded')).toBe('false');
      expect(wrapperEl.querySelector('.claudian-thinking-content')?.textContent)
        .toContain('The full reasoning stays in the expandable details.');
    });
  });
});
