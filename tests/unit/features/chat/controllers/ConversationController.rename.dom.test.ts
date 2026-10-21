/** @jest-environment jsdom */

import '@/providers';

import { fireEvent, screen, waitFor } from '@testing-library/dom';

import type { ConversationMeta } from '@/core/types';
import { ConversationController, type ConversationControllerDeps } from '@/features/chat/controllers/ConversationController';
import { ChatState } from '@/features/chat/state/ChatState';
import { setLocale } from '@/i18n/i18n';

HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };

describe('history inline rename', () => {
  afterEach(() => {
    document.body.replaceChildren();
    setLocale('en');
  });

  it.each([
    ['en', 'Conversation title', 'Rename'],
    ['zh-CN', '对话标题', '重命名'],
  ] as const)('labels the %s editor and retains Enter, Escape and blur behavior', async (locale, label, renameLabel) => {
    setLocale(locale);
    const conversation: ConversationMeta = {
      id: 'conv-1', providerId: 'claude', title: 'Original title',
      createdAt: 1000, lastActivityAt: 1000, messageCount: 1, preview: '',
    };
    const renameConversation = jest.fn(async (_id: string, title: string) => { conversation.title = title; });
    const controller = new ConversationController({
      plugin: { getConversationList: () => [conversation], renameConversation },
      state: new ChatState(),
      getMessagesEl: () => null,
    } as unknown as ConversationControllerDeps);
    const container = document.body.appendChild(document.createElement('div'));
    const render = () => controller.renderHistoryDropdown(container, {
      onSelectConversation: jest.fn(), onRerender: render,
    });
    render();
    screen.getByRole('button', { name: renameLabel }).click();
    const input = screen.getByRole('textbox', { name: label }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Original title'.length]);
    input.value = 'Saved by Enter';
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(renameConversation).toHaveBeenCalledWith('conv-1', 'Saved by Enter'));

    screen.getByRole('button', { name: renameLabel }).click();
    const cancelled = screen.getByRole('textbox', { name: label }) as HTMLInputElement;
    cancelled.value = 'Discard me';
    fireEvent.keyDown(cancelled, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: label })).toBeNull());
    expect(renameConversation).toHaveBeenCalledTimes(1);

    screen.getByRole('button', { name: renameLabel }).click();
    const blurred = screen.getByRole('textbox', { name: label }) as HTMLInputElement;
    blurred.value = 'Saved by blur';
    blurred.blur();
    await waitFor(() => expect(renameConversation).toHaveBeenCalledWith('conv-1', 'Saved by blur'));
    expect(renameConversation).toHaveBeenCalledTimes(2);
  });
});
