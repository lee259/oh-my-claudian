import { createMockEl } from '@test/helpers/MockElement';

import type { ChatMessage } from '@/core/types';
import { InputHistoryController } from '@/features/chat/tabs/InputHistoryController';

function createKeyEvent(
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>> = {},
): KeyboardEvent & { preventDefault: jest.Mock } {
  return {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    key,
    metaKey: false,
    preventDefault: jest.fn(),
    shiftKey: false,
    ...modifiers,
  } as unknown as KeyboardEvent & { preventDefault: jest.Mock };
}

function createInput(): HTMLTextAreaElement {
  const input = createMockEl('textarea') as unknown as HTMLTextAreaElement;
  input.selectionStart = 0;
  input.selectionEnd = 0;
  input.setSelectionRange = jest.fn((start: number, end: number) => {
    input.selectionStart = start;
    input.selectionEnd = end;
  });
  return input;
}

function createMessage(
  id: string,
  content: string,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    content,
    id,
    role: 'user',
    timestamp: 1,
    ...overrides,
  };
}

describe('InputHistoryController', () => {
  it('navigates sent user messages and restores the composer draft', () => {
    const input = createInput();
    const messages = [
      createMessage('user-1', 'first request'),
      createMessage('assistant-1', 'first response', { role: 'assistant' }),
      createMessage('user-2', 'latest request'),
    ];
    const controller = new InputHistoryController({
      getConversationId: () => 'conversation-1',
      getMessages: () => messages,
    });
    input.value = 'unsent draft';
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;

    const up = createKeyEvent('ArrowUp');
    expect(controller.handleKeydown(up, input)).toBe(true);
    expect(input.value).toBe('latest request');
    expect(up.preventDefault).toHaveBeenCalled();

    input.selectionStart = 0;
    input.selectionEnd = 0;
    controller.handleKeydown(createKeyEvent('ArrowUp'), input);
    expect(input.value).toBe('first request');

    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    controller.handleKeydown(createKeyEvent('ArrowDown'), input);
    expect(input.value).toBe('latest request');

    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    controller.handleKeydown(createKeyEvent('ArrowDown'), input);
    expect(input.value).toBe('unsent draft');
  });

  it('resets navigation after manual input and ignores non-boundary or modified keys', () => {
    const input = createInput();
    const messages = [createMessage('user-1', 'previous request')];
    const controller = new InputHistoryController({
      getConversationId: () => 'conversation-1',
      getMessages: () => messages,
    });
    input.value = 'current multiline\ntext';
    input.selectionStart = 1;
    input.selectionEnd = 1;

    const middleUp = createKeyEvent('ArrowUp');
    expect(controller.handleKeydown(middleUp, input)).toBe(false);
    expect(middleUp.preventDefault).not.toHaveBeenCalled();

    const modifiedUp = createKeyEvent('ArrowUp', { ctrlKey: true });
    expect(controller.handleKeydown(modifiedUp, input)).toBe(false);

    input.value = 'manual edit';
    controller.handleInput();
    input.selectionStart = 0;
    input.selectionEnd = 0;
    controller.handleKeydown(createKeyEvent('ArrowUp'), input);
    expect(input.value).toBe('previous request');
  });

  it('skips interrupt and rebuilt-context user messages', () => {
    const input = createInput();
    const messages = [
      createMessage('interrupt', 'interrupt', { isInterrupt: true }),
      createMessage('rebuilt', 'rebuilt', { isRebuiltContext: true }),
      createMessage('canonical', 'canonical request'),
    ];
    const controller = new InputHistoryController({
      getConversationId: () => 'conversation-1',
      getMessages: () => messages,
    });
    input.selectionStart = 0;
    input.selectionEnd = 0;

    controller.handleKeydown(createKeyEvent('ArrowUp'), input);
    expect(input.value).toBe('canonical request');
  });
});
