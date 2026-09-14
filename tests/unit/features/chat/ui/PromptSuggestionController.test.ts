/** @jest-environment jsdom */

import { PromptSuggestionController } from '@/features/chat/ui/PromptSuggestionController';

describe('PromptSuggestionController', () => {
  let container: HTMLDivElement;
  let input: HTMLTextAreaElement;
  let controller: PromptSuggestionController;

  beforeEach(() => {
    container = document.createElement('div');
    input = document.createElement('textarea');
    container.append(input);
    (container as HTMLDivElement & { createEl: HTMLElement['createEl'] }).createEl = ((tag, options) => {
      const element = document.createElement(tag) as HTMLElement;
      const info = options as any;
      if (info?.cls) element.className = info.cls;
      if (info?.attr) {
        for (const [name, value] of Object.entries(info.attr)) {
          element.setAttribute(name, String(value));
        }
      }
      container.append(element);
      return element;
    }) as HTMLElement['createEl'];
    document.body.append(container);
    controller = new PromptSuggestionController(container, input);
  });

  afterEach(() => {
    controller.destroy();
    container.remove();
  });

  it('shows a trimmed suggestion and accepts it with Tab', () => {
    controller.setSuggestion('  Explain the failing test  ');
    const suggestion = container.querySelector('button');
    expect(suggestion?.hidden).toBe(false);
    expect(suggestion?.textContent).toContain('Explain the failing test');

    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    expect(controller.handleKeydown(event)).toBe(true);
    expect(input.value).toBe('Explain the failing test');
    expect(suggestion?.hidden).toBe(true);
  });

  it('accepts with ArrowRight only at the end of the current draft', () => {
    controller.setSuggestion('Continue the refactor');
    input.value = 'Draft';
    input.setSelectionRange(2, 2);
    expect(controller.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }))).toBe(false);
    expect(input.value).toBe('Draft');

    input.setSelectionRange(input.value.length, input.value.length);
    expect(controller.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }))).toBe(true);
    expect(input.value).toBe('Continue the refactor');
  });

  it('clears the suggestion when the composer changes', () => {
    controller.setSuggestion('Inspect the diff');
    controller.clear();
    expect(container.querySelector('button')?.hidden).toBe(true);
  });

  it('does not consume modified Tab navigation', () => {
    controller.setSuggestion('Inspect the diff');
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true });

    expect(controller.handleKeydown(event)).toBe(false);
    expect(input.value).toBe('');
  });
});
