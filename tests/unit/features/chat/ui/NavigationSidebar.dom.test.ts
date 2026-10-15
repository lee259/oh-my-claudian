/** @jest-environment jsdom */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, within } from '@testing-library/dom';
import { axe } from 'jest-axe';
import { type App, Scope } from 'obsidian';

import { NavigationSidebar } from '@/features/chat/ui/NavigationSidebar';
import { getLocale, setLocale } from '@/i18n/i18n';

const css = readFileSync(path.resolve('src/style/components/nav-sidebar.css'), 'utf8');
const sidebars: NavigationSidebar[] = [];

afterEach(() => {
  for (const sidebar of sidebars.splice(0)) sidebar.destroy();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

function mount(scrollable: boolean, withPrompts = true) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const parentEl = document.body.createDiv();
  const messagesEl = parentEl.createDiv();
  if (withPrompts) {
    for (const title of ['First question', 'Second question']) {
      messagesEl.createDiv({
        cls: 'claudian-message claudian-message-user',
        attr: { 'data-toc-title': title },
      });
    }
  }
  Object.defineProperty(messagesEl, 'scrollHeight', {
    configurable: true,
    value: scrollable ? 2_000 : 400,
  });
  Object.defineProperty(messagesEl, 'clientHeight', { configurable: true, value: 400 });
  messagesEl.scrollTo = jest.fn() as never;

  const sidebar = new NavigationSidebar(parentEl, messagesEl);
  sidebars.push(sidebar);
  return { parentEl, messagesEl, view: within(parentEl) };
}

it('exposes named native navigation buttons and an accessible directory disclosure', async () => {
  const { parentEl, messagesEl, view } = mount(true);

  for (const name of [
    'Scroll to top',
    'Previous message',
    'Conversation directory',
    'Next message',
    'Scroll to bottom',
  ]) {
    expect(view.getByRole('button', { name }).getAttribute('type')).toBe('button');
  }

  const directory = view.getByRole('button', { name: 'Conversation directory' });
  expect(directory.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(directory);
  expect(directory.getAttribute('aria-expanded')).toBe('true');

  const entry = view.getByRole('button', { name: '2. Second question' });
  expect(entry.getAttribute('type')).toBe('button');
  expect((await axe(parentEl)).violations).toEqual([]);

  fireEvent.click(entry);
  expect(messagesEl.scrollTo).toHaveBeenCalled();
  expect(view.queryByRole('button', { name: '2. Second question' })).toBeNull();
  expect(directory.getAttribute('aria-expanded')).toBe('false');
});

it('removes hidden navigation from the accessibility tree and tab order', () => {
  const { view } = mount(false);

  expect(view.queryAllByRole('button')).toEqual([]);
  expect(view.getAllByRole('button', { hidden: true })).toHaveLength(5);
});

it('uses localized labels for navigation controls and the empty directory', () => {
  const previousLocale = getLocale();
  setLocale('zh-CN');
  try {
    const { parentEl, view } = mount(true, false);
    expect(view.getByRole('button', { name: '滚动到顶部' })).toBeTruthy();
    const directory = view.getByRole('button', { name: '对话目录' });
    fireEvent.click(directory);
    expect(parentEl.textContent).toContain('此对话中暂无用户提示词');
  } finally {
    setLocale(previousLocale);
  }
});

describe('Conversation directory keyboard interaction', () => {
  it('owns Escape in the host keymap and releases its scope when the directory closes', () => {
    const parent = document.body.createDiv();
    const messages = parent.createDiv();
    const pushScope = jest.fn();
    const popScope = jest.fn();
    const host = { scope: new Scope(), keymap: { pushScope, popScope } } as unknown as Pick<App, 'scope' | 'keymap'>;
    const navigation = new NavigationSidebar(parent, messages, undefined, host);
    try {
      parent.querySelector<HTMLButtonElement>('.claudian-nav-btn-toc')!.click();
      expect(pushScope).toHaveBeenCalledTimes(1);
      const scope = pushScope.mock.calls[0][0];
      const registration = (scope.register as jest.Mock).mock.calls.find((args) => args[1] === 'Escape');
      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      registration[2](event);
      expect(event.defaultPrevented).toBe(true);
      expect(parent.querySelector('.claudian-nav-toc-popover')).toBeNull();
      expect(popScope).toHaveBeenCalledWith(scope);
      navigation.destroy();
      expect(popScope).toHaveBeenCalledTimes(1);
    } finally { navigation.destroy(); parent.remove(); }
  });

  it('focuses entries, dismisses on Escape, and restores focus after selecting a prompt', () => {
    const parent = document.body.createDiv();
    const messages = parent.createDiv();
    messages.createDiv({ cls: 'claudian-message-user', attr: { 'data-toc-title': 'First prompt' } });
    messages.createDiv({ cls: 'claudian-message-user', attr: { 'data-toc-title': 'Second prompt' } });
    messages.scrollTo = jest.fn();
    const onIntent = jest.fn();
    const navigation = new NavigationSidebar(parent, messages, onIntent);
    const trigger = parent.querySelector<HTMLButtonElement>('.claudian-nav-btn-toc')!;
    try {
      trigger.click();
      let entries = parent.querySelectorAll<HTMLButtonElement>('.claudian-nav-toc-item');
      expect(document.activeElement).toBe(entries[0]);
      entries[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(document.activeElement).toBe(entries[1]);
      entries[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(parent.querySelector('.claudian-nav-toc-popover')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      trigger.click();
      entries = parent.querySelectorAll<HTMLButtonElement>('.claudian-nav-toc-item');
      entries[1].click();
      expect(parent.querySelector('.claudian-nav-toc-popover')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(onIntent).toHaveBeenLastCalledWith('away');
    } finally {
      navigation.destroy();
      parent.remove();
    }
  });
});
