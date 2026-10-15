/** @jest-environment jsdom */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, within } from '@testing-library/dom';
import { axe } from 'jest-axe';

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
