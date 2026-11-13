/** @jest-environment jsdom */
import '@/providers';

import { fireEvent, screen, waitFor } from '@testing-library/dom';

import type { ConversationMeta } from '@/core/types';
import { ConversationController, type ConversationControllerDeps } from '@/features/chat/controllers/ConversationController';
import { ChatState } from '@/features/chat/state/ChatState';

HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };

afterEach(() => document.body.replaceChildren());

it.each(['Enter', ' '] as const)('opens a history result with %s', async key => {
  const conversation: ConversationMeta = {
    id: 'keyboard-conversation', providerId: 'claude', title: 'Keyboard result',
    createdAt: 1000, lastActivityAt: 1000, messageCount: 1, preview: '',
  };
  const controller = new ConversationController({
    plugin: { getConversationList: () => [conversation] },
    state: new ChatState(), getMessagesEl: () => null,
  } as unknown as ConversationControllerDeps);
  const onSelectConversation = jest.fn().mockResolvedValue(undefined);
  const container = document.body.appendChild(document.createElement('div'));
  controller.renderHistoryDropdown(container, { onSelectConversation });

  const result = screen.getByRole('button', { name: /Keyboard result/ });
  result.focus();
  expect(document.activeElement).toBe(result);
  fireEvent.keyDown(result, { key });
  await waitFor(() => expect(onSelectConversation).toHaveBeenCalledWith(conversation.id, { source: 'keyboard' }));
});

it('ignores composition and unrelated keys on a history result', () => {
  const conversation: ConversationMeta = {
    id: 'keyboard-composition', providerId: 'claude', title: 'Composition result',
    createdAt: 1000, lastActivityAt: 1000, messageCount: 1, preview: '',
  };
  const controller = new ConversationController({
    plugin: { getConversationList: () => [conversation] },
    state: new ChatState(), getMessagesEl: () => null,
  } as unknown as ConversationControllerDeps);
  const onSelectConversation = jest.fn();
  const container = document.body.appendChild(document.createElement('div'));
  controller.renderHistoryDropdown(container, { onSelectConversation });
  const result = screen.getByRole('button', { name: /Composition result/ });

  fireEvent.keyDown(result, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(result, { key: 'ArrowDown' });

  expect(onSelectConversation).not.toHaveBeenCalled();
});

it('does not make history rows selectable when selection is disabled', () => {
  const conversation: ConversationMeta = {
    id: 'locked-conversation', providerId: 'claude', title: 'Locked result',
    createdAt: 1000, lastActivityAt: 1000, messageCount: 1, preview: '',
  };
  const controller = new ConversationController({
    plugin: { getConversationList: () => [conversation] },
    state: new ChatState(), getMessagesEl: () => null,
  } as unknown as ConversationControllerDeps);
  const onSelectConversation = jest.fn();
  const container = document.body.appendChild(document.createElement('div'));
  controller.renderHistoryDropdown(container, { onSelectConversation, allowConversationSelection: false });
  const result = container.querySelector<HTMLElement>('.claudian-history-item-title')!;
  expect(result.hasAttribute('tabindex')).toBe(false);
  expect(result.getAttribute('role')).not.toBe('button');
  fireEvent.keyDown(result, { key: 'Enter' });
  expect(onSelectConversation).not.toHaveBeenCalled();
});

it('does not open the conversation when typing or confirming its inline rename', async () => {
  const conversation: ConversationMeta = {
    id: 'rename-keyboard', providerId: 'claude', title: 'Original title',
    createdAt: 1000, lastActivityAt: 1000, messageCount: 1, preview: '',
  };
  const renameConversation = jest.fn().mockResolvedValue(undefined);
  const controller = new ConversationController({
    plugin: { getConversationList: () => [conversation], renameConversation },
    state: new ChatState(), getMessagesEl: () => null,
  } as unknown as ConversationControllerDeps);
  const onSelectConversation = jest.fn().mockResolvedValue(undefined);
  const container = document.body.appendChild(document.createElement('div'));
  controller.renderHistoryDropdown(container, { onSelectConversation, onRerender: jest.fn() });

  screen.getByRole('button', { name: 'Rename' }).click();
  const input = screen.getByRole('textbox', { name: 'Conversation title' }) as HTMLInputElement;
  expect(input.closest('[role="button"]')).toBeNull();
  input.value = 'Renamed title';
  fireEvent.keyDown(input, { key: ' ' });
  fireEvent.keyDown(input, { key: 'Enter' });

  await waitFor(() => expect(renameConversation).toHaveBeenCalled());
  expect(onSelectConversation).not.toHaveBeenCalled();
});

it.each(['another conversation', 'focused conversation'] as const)(
  'keeps the selected result focused when %s changes', changed => {
    const conversations: ConversationMeta[] = [
      { id: 'focus-target', providerId: 'claude', title: 'Focus target', createdAt: 1000, lastActivityAt: 1000, messageCount: 1, preview: '' },
      { id: 'focus-other', providerId: 'claude', title: 'Other conversation', createdAt: 900, lastActivityAt: 900, messageCount: 1, preview: '' },
    ];
    const controller = new ConversationController({
      plugin: { getConversationList: () => conversations },
      state: new ChatState(), getMessagesEl: () => null,
    } as unknown as ConversationControllerDeps);
    const container = document.body.appendChild(document.createElement('div'));
    const options = { onSelectConversation: jest.fn(), preserveListState: true };
    controller.renderHistoryDropdown(container, options);
    screen.getByRole('button', { name: /Focus target/ }).focus();

    conversations[changed === 'focused conversation' ? 0 : 1].title += ' updated';
    controller.renderHistoryDropdown(container, options);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Focus target/ }));
  },
);

it('does not steal focus moved elsewhere during a history refresh', () => {
  const conversation: ConversationMeta = {
    id: 'focus-target', providerId: 'claude', title: 'Focus target',
    createdAt: 1000, lastActivityAt: 1000, messageCount: 1, preview: '',
  };
  const controller = new ConversationController({
    plugin: { getConversationList: () => [conversation] },
    state: new ChatState(), getMessagesEl: () => null,
  } as unknown as ConversationControllerDeps);
  const container = document.body.appendChild(document.createElement('div'));
  const other = document.body.appendChild(document.createElement('button'));
  const options = { onSelectConversation: jest.fn(), preserveListState: true };
  controller.renderHistoryDropdown(container, options);
  screen.getByRole('button', { name: /Focus target/ }).focus();

  conversation.title = 'Focus target updated';
  controller.renderHistoryDropdown(container, { ...options, onBeforeRestoreListState: () => other.focus() });

  expect(document.activeElement).toBe(other);
});

it.each([false, true])('moves focus to newly revealed history after loading more (preserve state: %s)', preserveListState => {
  const conversations: ConversationMeta[] = Array.from({ length: 3 }, (_, index) => ({
    id: `page-${index}`, providerId: 'claude', title: `Page result ${index}`,
    createdAt: 1000 - index, lastActivityAt: 1000 - index, messageCount: 1, preview: '',
  }));
  const controller = new ConversationController({
    plugin: { getConversationList: () => conversations },
    state: new ChatState(), getMessagesEl: () => null,
  } as unknown as ConversationControllerDeps);
  const container = document.body.appendChild(document.createElement('div'));
  const options = { onSelectConversation: jest.fn(), pageSize: 2, preserveListState };
  controller.renderHistoryDropdown(container, options);
  const loadMore = container.querySelector<HTMLButtonElement>('.claudian-history-load-more')!;
  loadMore.focus();
  loadMore.click();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /Page result 2/ }));
});

it('does not steal focus moved while loading more history', () => {
  const conversations: ConversationMeta[] = Array.from({ length: 3 }, (_, index) => ({
    id: `page-${index}`, providerId: 'claude', title: `Page result ${index}`,
    createdAt: 1000 - index, lastActivityAt: 1000 - index, messageCount: 1, preview: '',
  }));
  const controller = new ConversationController({
    plugin: { getConversationList: () => conversations },
    state: new ChatState(), getMessagesEl: () => null,
  } as unknown as ConversationControllerDeps);
  const container = document.body.appendChild(document.createElement('div'));
  const other = document.body.appendChild(document.createElement('button'));
  let moveFocus = false;
  controller.renderHistoryDropdown(container, {
    onSelectConversation: jest.fn(), pageSize: 2,
    onBeforeRestoreListState: () => { if (moveFocus) other.focus(); },
  });
  const loadMore = container.querySelector<HTMLButtonElement>('.claudian-history-load-more')!;
  loadMore.focus();
  moveFocus = true;
  loadMore.click();
  expect(document.activeElement).toBe(other);
});

it('focuses the next selectable result if the first newly revealed conversation is current', () => {
  const conversations: ConversationMeta[] = Array.from({ length: 4 }, (_, index) => ({
    id: `page-${index}`, providerId: 'claude', title: `Page result ${index}`,
    createdAt: 1000 - index, lastActivityAt: 1000 - index, messageCount: 1, preview: '',
  }));
  const state = new ChatState();
  state.currentConversationId = 'page-2';
  const controller = new ConversationController({
    plugin: { getConversationList: () => conversations }, state, getMessagesEl: () => null,
  } as unknown as ConversationControllerDeps);
  const container = document.body.appendChild(document.createElement('div'));
  controller.renderHistoryDropdown(container, { onSelectConversation: jest.fn(), pageSize: 2 });
  const loadMore = container.querySelector<HTMLButtonElement>('.claudian-history-load-more')!;
  loadMore.focus();
  loadMore.click();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /Page result 3/ }));
});

it('focuses an available action when the last newly revealed conversation is current', () => {
  const conversations: ConversationMeta[] = Array.from({ length: 3 }, (_, index) => ({
    id: `page-${index}`, providerId: 'claude', title: `Page result ${index}`,
    createdAt: 1000 - index, lastActivityAt: 1000 - index, messageCount: 1, preview: '',
  }));
  const state = new ChatState();
  state.currentConversationId = 'page-2';
  const controller = new ConversationController({
    plugin: { getConversationList: () => conversations }, state, getMessagesEl: () => null,
  } as unknown as ConversationControllerDeps);
  const container = document.body.appendChild(document.createElement('div'));
  controller.renderHistoryDropdown(container, { onSelectConversation: jest.fn(), pageSize: 2 });
  const loadMore = container.querySelector<HTMLButtonElement>('.claudian-history-load-more')!;
  loadMore.focus();
  loadMore.click();
  const lastItem = container.querySelector('[data-conversation-id="page-2"]')!;
  expect(document.activeElement).toBe(lastItem.querySelector('button:not(:disabled)'));
});

it('keeps focus in the history item when the focused conversation becomes current', () => {
  const conversation: ConversationMeta = {
    id: 'becomes-current', providerId: 'claude', title: 'Focused result',
    createdAt: 1000, lastActivityAt: 1000, messageCount: 1, preview: '',
  };
  const state = new ChatState();
  const controller = new ConversationController({
    plugin: { getConversationList: () => [conversation] }, state, getMessagesEl: () => null,
  } as unknown as ConversationControllerDeps);
  const container = document.body.appendChild(document.createElement('div'));
  const options = { onSelectConversation: jest.fn(), preserveListState: true };
  controller.renderHistoryDropdown(container, options);
  screen.getByRole('button', { name: /Focused result/ }).focus();
  state.currentConversationId = conversation.id;
  controller.renderHistoryDropdown(container, options);
  expect(document.activeElement).toBe(container.querySelector('[data-conversation-id="becomes-current"] button:not(:disabled)'));
});

it.each([false, true])('returns focus to history search when the focused result disappears (empty: %s)', empty => {
  const conversations: ConversationMeta[] = [
    { id: 'removed', providerId: 'claude', title: 'Removed result', createdAt: 1000, lastActivityAt: 1000, messageCount: 1, preview: '' },
    { id: 'remaining', providerId: 'claude', title: 'Remaining result', createdAt: 900, lastActivityAt: 900, messageCount: 1, preview: '' },
  ];
  const controller = new ConversationController({
    plugin: { getConversationList: () => conversations }, state: new ChatState(), getMessagesEl: () => null,
  } as unknown as ConversationControllerDeps);
  const menu = document.body.appendChild(document.createElement('div'));
  menu.className = 'claudian-history-menu';
  const search = menu.appendChild(document.createElement('input'));
  search.className = 'claudian-home-history-search-input';
  const container = menu.appendChild(document.createElement('div'));
  const options = { onSelectConversation: jest.fn(), preserveListState: true, getFocusFallback: () => search };
  controller.renderHistoryDropdown(container, options);
  screen.getByRole('button', { name: /Removed result/ }).focus();
  conversations.splice(0, empty ? 2 : 1);
  controller.renderHistoryDropdown(container, options);
  expect(document.activeElement).toBe(search);
});
