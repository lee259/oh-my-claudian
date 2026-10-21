/** @jest-environment jsdom */

import { fireEvent, screen } from '@testing-library/dom';

import { ResumeSessionDropdown } from '@/shared/components/ResumeSessionDropdown';

describe('resume picker scrolling', () => {
  let dropdown: ResumeSessionDropdown;
  let list: HTMLElement;
  let ancestor: HTMLElement;
  let options: HTMLElement[];
  let scrollIntoView: jest.Mock;
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    ancestor = document.body.appendChild(document.createElement('div'));
    ancestor.scrollTop = 120;
    const container = ancestor.appendChild(document.createElement('div'));
    const input = container.appendChild(document.createElement('textarea'));
    dropdown = new ResumeSessionDropdown(container, input, [1, 2, 3].map(index => ({
      id: `conv-${index}`, providerId: 'claude', title: `Chat ${index}`,
      createdAt: 1000, lastActivityAt: 4000 - index, messageCount: 1, preview: '',
    })), null, { onSelect: jest.fn(), onDismiss: jest.fn() });
    list = screen.getByRole('listbox');
    options = screen.getAllByRole('option');
    list.getBoundingClientRect = () => new DOMRect(0, 0, 300, 100);
    options.forEach((option, index) => {
      option.getBoundingClientRect = () => new DOMRect(0, index * 50 - list.scrollTop, 300, 50);
    });
  });

  afterEach(() => {
    dropdown.destroy();
    document.body.replaceChildren();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('updates hover selection without scrolling the list or workspace', () => {
    fireEvent.mouseEnter(options[2]);
    expect(options[2].getAttribute('aria-selected')).toBe('true');
    expect(list.scrollTop).toBe(0);
    expect(ancestor.scrollTop).toBe(120);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('retains keyboard selection when scrolling changes the row under a stationary pointer', () => {
    fireEvent.mouseEnter(options[2]);
    dropdown.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    fireEvent.mouseEnter(options[0]);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.mouseMove(options[0]);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(list.scrollTop).toBe(0);
    expect(ancestor.scrollTop).toBe(120);
  });

  it('keeps keyboard selection visible by scrolling only its list in both directions', () => {
    const arrow = (key: string) => dropdown.handleKeydown(new KeyboardEvent('keydown', { key }));
    arrow('ArrowDown');
    expect(list.scrollTop).toBe(0);
    arrow('ArrowDown');
    expect(list.scrollTop).toBe(50);
    arrow('ArrowUp');
    arrow('ArrowUp');
    expect(list.scrollTop).toBe(0);
    expect(ancestor.scrollTop).toBe(120);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
