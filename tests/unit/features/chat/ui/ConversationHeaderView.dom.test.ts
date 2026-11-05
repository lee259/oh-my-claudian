/** @jest-environment jsdom */

import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { ConversationHeaderView } from '@/features/chat/ui/ConversationHeaderView';

describe('ConversationHeaderView', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.className = 'claudian-conversation-header-host';
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('uses the conversation toolbar layout on home and preserves action order', () => {
    const callbacks = [jest.fn(), jest.fn(), jest.fn()];
    render(h(ConversationHeaderView, {
      title: '',
      isHome: true,
      onOpenHistory: callbacks[0],
      onOpenSettings: callbacks[1],
      onNewConversation: callbacks[2],
    }), container);
    const actions = container.querySelector('.claudian-conversation-header-actions');
    expect(actions).not.toBeNull();
    const buttons = actions!.querySelectorAll<HTMLButtonElement>('.claudian-conversation-header-action');
    expect(buttons).toHaveLength(3);
    buttons.forEach((button, index) => {
      expect(button.querySelector('.claudian-conversation-header-icon')).not.toBeNull();
      button.click();
      expect(callbacks[index]).toHaveBeenCalledTimes(1);
    });
  });

  it('closes options when navigating home and keeps them closed on return', async () => {
    const draw = (isHome = false) => render(h(ConversationHeaderView, {
      title: 'Session', isHome, onRenameConversation: jest.fn(),
    }), container);
    await act(() => draw());
    await act(() => container.querySelector<HTMLButtonElement>('.claudian-conversation-header-menu-action')!.click());
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    await act(() => draw(true));
    await act(() => draw(false));
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('restores focus to options when Escape closes a focused menu', async () => {
    await act(() => render(h(ConversationHeaderView, {
      title: 'Session', onRenameConversation: jest.fn(),
    }), container));
    const trigger = container.querySelector<HTMLButtonElement>('.claudian-conversation-header-menu-action')!;
    await act(() => trigger.click());
    const item = container.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    item.focus();
    container.addEventListener('keydown', event => event.stopPropagation());
    await act(() => { item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it.each(['pointerdown', 'Escape'])('keeps external focus when %s dismisses options', async eventType => {
    await act(() => render(h(ConversationHeaderView, {
      title: 'Session', onRenameConversation: jest.fn(),
    }), container));
    await act(() => container.querySelector<HTMLButtonElement>('.claudian-conversation-header-menu-action')!.click());
    const external = document.createElement('input');
    container.append(external);
    external.focus();
    await act(() => { external.dispatchEvent(eventType === 'Escape'
      ? new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      : new Event('pointerdown', { bubbles: true })); });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(external);
  });

  it('navigates options with arrow keys, skips disabled items, and exposes expanded state', async () => {
    const draw = (isRunning = false) => render(h(ConversationHeaderView, {
      title: 'Session', isRunning, onRenameConversation: jest.fn(), onArchiveConversation: jest.fn(),
    }), container);
    await act(() => draw());
    const trigger = container.querySelector<HTMLButtonElement>('.claudian-conversation-header-menu-action')!;
    const key = async (value: string) => {
      await act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); });
    };
    trigger.focus();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await key('ArrowDown');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Rename');
    await key('ArrowDown');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Archive');
    await key('ArrowDown');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Rename');
    await key('End');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Archive');
    await key('Home');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Rename');
    await key('Escape');
    expect(document.activeElement).toBe(trigger);
    await act(() => draw(true));
    await key('ArrowUp');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Rename');
    await key('ArrowDown');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Rename');
  });

  it('offers rename and archive actions from the conversation menu', async () => {
    const onRenameConversation = jest.fn();
    const onArchiveConversation = jest.fn();
    render(h(ConversationHeaderView, {
      title: 'Current session',
      onRenameConversation,
      onArchiveConversation,
    } as any), container);

    expect(container.querySelector('.claudian-conversation-header-rename-action')).toBeNull();
    container.querySelector<HTMLButtonElement>(
      '.claudian-conversation-header-menu-action',
    )?.click();
    await Promise.resolve();

    const menu = container.querySelector('.claudian-conversation-actions-menu')!;
    expect(menu.querySelectorAll('.claudian-conversation-menu-item')).toHaveLength(2);
    expect(menu.querySelector('[aria-label="Rename"]')).not.toBeNull();
    expect(menu.querySelector('[aria-label="Archive"]')).not.toBeNull();
    const actions = container.querySelector('.claudian-conversation-header-actions')!;
    expect(actions.children[0].querySelector('.claudian-conversation-header-menu-action'))
      .not.toBeNull();
    expect(actions.children[1].getAttribute('aria-label')).toBe('Chat history');
    menu.querySelector<HTMLButtonElement>('[aria-label="Rename"]')?.click();
    menu.querySelector<HTMLButtonElement>('[aria-label="Archive"]')?.click();

    expect(onRenameConversation).toHaveBeenCalledTimes(1);
    expect(onArchiveConversation).toHaveBeenCalledTimes(1);
  });

  it('disables archive while the conversation is running', async () => {
    const onRenameConversation = jest.fn();
    const onArchiveConversation = jest.fn();
    render(h(ConversationHeaderView, {
      title: 'Current session',
      onRenameConversation,
      onArchiveConversation,
      isRunning: true,
    } as any), container);

    container.querySelector<HTMLButtonElement>(
      '.claudian-conversation-header-menu-action',
    )?.click();
    await Promise.resolve();

    container.querySelector<HTMLButtonElement>(
      '.claudian-conversation-header-menu-action',
    )?.click();

    expect(container.querySelector<HTMLButtonElement>('[aria-label="Archive"]')?.disabled)
      .toBe(true);
  });
});
