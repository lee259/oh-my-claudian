/** @jest-environment jsdom */

import { h, render } from 'preact';

import { ConversationHeaderView } from '@/features/chat/ui/ConversationHeaderView';

jest.mock('obsidian', () => ({
  setIcon: jest.fn(),
}));

describe('ConversationHeaderView', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('renames the current conversation from its header', async () => {
    const onRenameConversation = jest.fn();
    render(h(ConversationHeaderView, {
      title: 'Current session',
      onRenameConversation,
    } as any), container);

    container.querySelector<HTMLButtonElement>(
      '.claudian-conversation-header-rename-action',
    )?.click();
    await Promise.resolve();
    const input = container.querySelector<HTMLInputElement>(
      '.claudian-conversation-header-rename-input',
    );
    expect(input).not.toBeNull();

    input!.value = 'Renamed session';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();

    expect(onRenameConversation).toHaveBeenCalledWith('Renamed session');
  });

  it('cancels a current-title edit with Escape', async () => {
    const onRenameConversation = jest.fn();
    render(h(ConversationHeaderView, {
      title: 'Current session',
      onRenameConversation,
    } as any), container);

    container.querySelector<HTMLButtonElement>(
      '.claudian-conversation-header-rename-action',
    )?.click();
    await Promise.resolve();
    const input = container.querySelector<HTMLInputElement>(
      '.claudian-conversation-header-rename-input',
    )!;
    input.value = 'Discard this';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();

    expect(onRenameConversation).not.toHaveBeenCalled();
    expect(container.querySelector('.claudian-conversation-header-title')?.textContent)
      .toBe('Current session');
  });
});
