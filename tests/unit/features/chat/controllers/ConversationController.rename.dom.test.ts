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
  it('keeps a failed rename cancellable', async () => {
    const conversation: ConversationMeta = {
      id: 'conv-1', providerId: 'claude', title: 'Original title',
      createdAt: 1000, lastActivityAt: 1000, messageCount: 1, preview: '',
    };
    const renameConversation = jest.fn().mockRejectedValue(new Error('Storage unavailable'));
    const controller = new ConversationController({
      plugin: { getConversationList: () => [conversation], renameConversation },
      state: new ChatState(), getMessagesEl: () => null,
    } as unknown as ConversationControllerDeps);
    const container = document.body.appendChild(document.createElement('div'));
    const render = () => controller.renderHistoryDropdown(container, {
      onSelectConversation: jest.fn(), onRerender: render,
    });
    render();
    screen.getByRole('button', { name: 'Rename' }).click();
    const input = screen.getByRole('textbox', { name: 'Conversation title' }) as HTMLInputElement;
    input.value = 'Unsaved title';
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(renameConversation).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(input.isConnected).toBe(true);
    expect(conversation.title).toBe('Original title');
    expect(controller.cancelInlineRename()).toBe(true);
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Conversation title' })).toBeNull());
  });
  function openRename(renameConversation: jest.Mock) {
    const conversation: ConversationMeta = {
      id: 'conv-1', providerId: 'claude', title: 'Original title',
      createdAt: 1000, lastActivityAt: 1000, messageCount: 1, preview: '',
    };
    const controller = new ConversationController({
      plugin: { getConversationList: () => [conversation], renameConversation },
      state: new ChatState(), getMessagesEl: () => null,
    } as unknown as ConversationControllerDeps);
    const container = document.body.appendChild(document.createElement('div'));
    const render = jest.fn((): void => controller.renderHistoryDropdown(container, {
      onSelectConversation: jest.fn(), onRerender: render,
    }));
    render();
    const begin = () => {
      screen.getByRole('button', { name: 'Rename' }).click();
      return screen.getByRole('textbox', { name: 'Conversation title' }) as HTMLInputElement;
    };
    return { controller, render, begin, input: begin() };
  }

  it('refocuses a failed save and accepts a corrected retry without duplicate saves', async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValue(undefined);
    const { input, controller } = openRename(save);
    input.value = 'First attempt';
    input.blur();
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.value).toBe('First attempt');
    input.value = 'Corrected title';
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(save.mock.calls).toEqual([['conv-1', 'First attempt'], ['conv-1', 'Corrected title']]);
    expect(controller.cancelInlineRename()).toBe(false);
  });

  it.each(['resolve', 'reject'] as const)('does not revive a dismissed editor when a pending save settles by %s', async outcome => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const save = jest.fn(() => new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
    const { input, controller, render, begin } = openRename(save);
    input.value = 'Pending title';
    input.blur();
    expect(save).toHaveBeenCalledTimes(1);
    expect(controller.cancelInlineRename()).toBe(true);
    const replacement = begin();
    replacement.value = 'Replacement draft';
    const renders = render.mock.calls.length;
    if (outcome === 'resolve') resolve(); else reject(new Error('Storage unavailable'));
    await new Promise(done => setTimeout(done, 0));
    expect(render).toHaveBeenCalledTimes(renders);
    expect(replacement.isConnected).toBe(true);
    expect(replacement.value).toBe('Replacement draft');
    expect(controller.cancelInlineRename()).toBe(true);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });

});
