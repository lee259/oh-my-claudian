/** @jest-environment jsdom */

import { axe } from 'jest-axe';

import { SelectableDropdown } from '@/shared/components/SelectableDropdown';

// Obsidian's host helper is absent from jsdom's native elements.
HTMLElement.prototype.setText ??= function (text: string): void { this.textContent = text; };
HTMLElement.prototype.scrollIntoView ??= jest.fn();

it('exposes named suggestions and the keyboard-selected option on the native textarea', async () => {
  HTMLElement.prototype.scrollIntoView ??= jest.fn();
  const container = document.body.createDiv();
  const input = container.createEl('textarea', { attr: { 'aria-label': 'Message' } });
  const dropdown = new SelectableDropdown<string>(container, {
    listClassName: 'suggestions', itemClassName: 'suggestion', emptyClassName: 'empty',
    accessibility: { inputEl: input, label: 'Input suggestions' },
  });
  try {
    dropdown.render({ items: ['First', 'Second'], selectedIndex: 0, emptyText: 'No suggestions', renderItem: (item, el) => el.textContent = item });
    const list = container.querySelector('[role="listbox"]');
    expect(list?.getAttribute('aria-label')).toBe('Input suggestions');
    expect(input.getAttribute('aria-controls')).toBe(list?.id);
    dropdown.moveSelection(1);
    const selected = container.querySelector('[role="option"][aria-selected="true"]');
    expect(selected?.textContent).toBe('Second');
    expect(input.getAttribute('aria-activedescendant')).toBe(selected?.id);
    expect(input.hasAttribute('aria-expanded')).toBe(false);
    expect((await axe(container)).violations).toEqual([]);
    dropdown.hide();
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(input.hasAttribute('aria-controls')).toBe(false);
  } finally {
    dropdown.destroy(); container.remove();
  }
});

it('keeps popup IDs distinct and leaves the newer popup relationships intact', () => {
  const container = document.body.createDiv();
  const input = container.createEl('textarea');
  const create = () => new SelectableDropdown<string>(container, {
    listClassName: 'suggestions', itemClassName: 'suggestion', emptyClassName: 'empty',
    accessibility: { inputEl: input, label: 'Input suggestions' },
  });
  const first = create();
  const second = create();
  const render = (dropdown: SelectableDropdown<string>) => dropdown.render({ items: ['Option'], selectedIndex: 0, emptyText: 'Empty', renderItem: (item, el) => { el.textContent = item; } });
  try {
    render(first);
    const firstId = input.getAttribute('aria-controls');
    render(second);
    const secondId = input.getAttribute('aria-controls');
    const activeOption = input.getAttribute('aria-activedescendant');
    expect(firstId).not.toBe(secondId);
    first.destroy();
    expect(input.getAttribute('aria-controls')).toBe(secondId);
    expect(input.getAttribute('aria-activedescendant')).toBe(activeOption);
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    second.render({ items: [], selectedIndex: 0, emptyText: 'Empty', renderItem: () => undefined });
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    second.hide();
    expect(input.hasAttribute('aria-controls')).toBe(false);
    expect(input.hasAttribute('aria-autocomplete')).toBe(false);
  } finally {
    first.destroy(); second.destroy(); container.remove();
  }
});

it('connects slash-command keyboard navigation and Escape to the rendered textarea relationships', async () => {
  const { SlashCommandDropdown } = await import('@/shared/components/SlashCommandDropdown');
  const container = document.body.createDiv();
  const input = container.createEl('textarea', { attr: { 'aria-label': 'Message' } });
  const dropdown = new SlashCommandDropdown(container, input, { onSelect: () => undefined, onHide: () => undefined });
  try {
    input.value = '/'; input.selectionStart = 1; input.selectionEnd = 1;
    input.dispatchEvent(new Event('input'));
    const first = input.getAttribute('aria-activedescendant');
    expect(first).toBeTruthy();
    expect(dropdown.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBe(true);
    expect(input.getAttribute('aria-activedescendant')).not.toBe(first);
    expect((await axe(container)).violations).toEqual([]);
    dropdown.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dropdown.isVisible()).toBe(false);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(input.hasAttribute('aria-controls')).toBe(false);
  } finally {
    dropdown.destroy(); container.remove();
  }
});
