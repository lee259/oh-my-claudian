/** @jest-environment jsdom */

import { h, render } from 'preact';

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
