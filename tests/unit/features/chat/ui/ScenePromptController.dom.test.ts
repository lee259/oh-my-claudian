/** @jest-environment jsdom */

import { fireEvent, getByRole, queryByRole } from '@testing-library/dom';

import { ScenePromptController } from '@/features/chat/ui/ScenePromptController';

it('inserts a selected suggestion as a draft and reacts to context and input changes', () => {
  const container = document.createElement('div');
  const messages = document.createElement('div');
  const input = document.createElement('textarea');
  container.createDiv = () => { const el = document.createElement('div'); container.append(el); return el; };
  document.body.append(container, messages, input);
  const context = { hasSelection: false, hasCurrentNote: true, hasMessages: false };
  const inputChanged = jest.fn();
  input.addEventListener('input', inputChanged);
  const controller = new ScenePromptController(container, input, messages, () => context);
  fireEvent.click(getByRole(container, 'button', { name: 'Summarize note' }));
  expect(input.value).toBe('Summarize the current note in a few key points.');
  expect(inputChanged).toHaveBeenCalledTimes(1);
  expect(queryByRole(container, 'button', { name: 'Summarize note' })).toBeNull();
  input.value = '';
  context.hasSelection = true;
  controller.refresh();
  expect(getByRole(container, 'button', { name: 'Explain selection' })).toBeTruthy();
  controller.destroy();
  container.remove(); messages.remove(); input.remove();
});

it('hides suggestions when a message is added', async () => {
  const container = document.createElement('div');
  const messages = document.createElement('div');
  const input = document.createElement('textarea');
  container.createDiv = () => { const el = document.createElement('div'); container.append(el); return el; };
  const context = { hasSelection: false, hasCurrentNote: true, hasMessages: false };
  const controller = new ScenePromptController(container, input, messages, () => context);
  expect(getByRole(container, 'button', { name: 'Summarize note' })).toBeTruthy();
  context.hasMessages = true;
  messages.append(document.createElement('div'));
  await Promise.resolve();
  expect(queryByRole(container, 'button', { name: 'Summarize note' })).toBeNull();
  controller.destroy();
});
