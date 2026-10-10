/** @jest-environment jsdom */
import {
  appendThinkingContent, createThinkingBlock, finalizeThinkingBlock,
} from '@/features/chat/rendering/ThinkingBlockRenderer';

HTMLElement.prototype.setText = function setText(text: string): void { this.textContent = text; };

describe('Transient reasoning status', () => {
  afterEach(() => document.body.replaceChildren());

  it('updates one non-expandable live label and removes it on completion', async () => {
    const host = document.body.createDiv();
    const state = createThinkingBlock(host, { presentation: 'status' });
    const render = jest.fn();
    await appendThinkingContent(state, '**Reviewing guidance**', render);
    expect(host.querySelector('[role="button"]')).toBeNull();
    expect(host.querySelector('.claudian-thinking-block')).toBeNull();
    expect(state.labelEl.textContent).toBe('Reviewing guidance');
    await appendThinkingContent(state, '\n\nChecking references', render);
    expect(host.querySelectorAll('.claudian-reasoning-status')).toHaveLength(1);
    expect(state.labelEl.textContent).toBe('Checking references');
    expect(state.contentEl.hidden).toBe(true);
    expect(render).not.toHaveBeenCalled();
    finalizeThinkingBlock(state);
    expect(host.querySelector('.claudian-reasoning-status')).toBeNull();
    expect(state.content).toBe('**Reviewing guidance**\n\nChecking references');
    expect(state.timerInterval).toBeNull();
  });

  it('keeps ordinary thinking expandable after completion', async () => {
    const host = document.body.createDiv();
    const state = createThinkingBlock(host);
    try {
      await appendThinkingContent(state, 'Provider reasoning', jest.fn());
      finalizeThinkingBlock(state);
      expect(host.querySelector('.claudian-thinking-block')).not.toBeNull();
      expect(host.querySelector('[role="button"]')).not.toBeNull();
    } finally { finalizeThinkingBlock(state); }
  });
});
