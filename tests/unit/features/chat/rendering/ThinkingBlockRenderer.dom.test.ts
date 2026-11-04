/** @jest-environment jsdom */
import {
  appendThinkingContent, createThinkingBlock, finalizeThinkingBlock, renderStoredThinkingBlock,
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

describe('stored thinking preparation', () => {
  let idle: IdleRequestCallback[];
  let original: typeof window.requestIdleCallback;

  beforeEach(() => {
    idle = [];
    original = window.requestIdleCallback;
    window.requestIdleCallback = jest.fn(callback => { idle.push(callback); return idle.length; });
  });

  afterEach(() => {
    window.requestIdleCallback = original;
    document.body.replaceChildren();
  });

  it('prepares a connected block during idle time and does not render on expansion', async () => {
    const render = jest.fn().mockResolvedValue(undefined);
    const parent = document.body.createDiv();
    const block = renderStoredThinkingBlock(parent, 'Detailed **reasoning**', 1, render);
    expect(render).not.toHaveBeenCalled();
    expect(idle).toHaveLength(1);
    idle.shift()!({ didTimeout: false, timeRemaining: () => 10 });
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);
    block.querySelector<HTMLElement>('.claudian-thinking-header')!.click();
    expect(render).toHaveBeenCalledTimes(1);
    expect(block.querySelector('.claudian-thinking-header')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('falls back to rendering when opened before preparation and skips the queued work', async () => {
    const render = jest.fn().mockResolvedValue(undefined);
    const block = renderStoredThinkingBlock(document.body.createDiv(), 'reasoning', 1, render);
    block.querySelector<HTMLElement>('.claudian-thinking-header')!.click();
    expect(render).toHaveBeenCalledTimes(1);
    idle.shift()!({ didTimeout: false, timeRemaining: () => 10 });
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('does not prepare a block removed before its idle turn', async () => {
    const render = jest.fn().mockResolvedValue(undefined);
    const block = renderStoredThinkingBlock(document.body.createDiv(), 'reasoning', 1, render);
    block.remove();
    idle.shift()!({ didTimeout: false, timeRemaining: () => 10 });
    await Promise.resolve();
    expect(render).not.toHaveBeenCalled();
  });

  it('spreads preparation across idle turns rather than rendering the whole transcript at once', async () => {
    jest.useFakeTimers();
    try {
      const render = jest.fn().mockResolvedValue(undefined);
      const parent = document.body.createDiv();
      renderStoredThinkingBlock(parent, 'first', 1, render);
      renderStoredThinkingBlock(parent, 'second', 1, render);
      expect(idle).toHaveLength(1);
      idle.shift()!({ didTimeout: false, timeRemaining: () => 10 });
      expect(render).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(50);
      expect(idle).toHaveLength(1);
      idle.shift()!({ didTimeout: false, timeRemaining: () => 10 });
      expect(render).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens long reasoning without measuring its full layout synchronously', () => {
    const block = renderStoredThinkingBlock(document.body.createDiv(), 'reasoning '.repeat(600), 1, jest.fn().mockResolvedValue(undefined));
    const content = block.querySelector<HTMLElement>('.claudian-thinking-content')!;
    content.animate = jest.fn();
    const measure = jest.spyOn(content, 'getBoundingClientRect');
    block.querySelector<HTMLElement>('.claudian-thinking-header')!.click();
    expect(measure).not.toHaveBeenCalled();
    expect(content.hasClass('claudian-hidden')).toBe(false);
    idle.shift()!({ didTimeout: false, timeRemaining: () => 10 });
  });

  it('bounds queued work and still allows an evicted block to open', () => {
    jest.useFakeTimers();
    try {
      const render = jest.fn().mockResolvedValue(undefined);
      const parent = document.body.createDiv();
      const blocks = Array.from({ length: 5 }, (_, i) => renderStoredThinkingBlock(parent, `reasoning ${i}`, 1, render));
      for (let i = 0; i < 4; i++) {
        idle.shift()!({ didTimeout: false, timeRemaining: () => 10 });
        jest.advanceTimersByTime(50);
      }
      expect(render).toHaveBeenCalledTimes(4);
      expect(render).not.toHaveBeenCalledWith(expect.anything(), 'reasoning 0');
      blocks[0].querySelector<HTMLElement>('.claudian-thinking-header')!.click();
      expect(render).toHaveBeenCalledWith(expect.anything(), 'reasoning 0');
    } finally {
      jest.useRealTimers();
    }
  });
});
