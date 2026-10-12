/** @jest-environment jsdom */

import '@/providers';

import { Component, MarkdownRenderer } from 'obsidian';

import type { ProviderId } from '@/core/providers/types';
import type { ChatMessage } from '@/core/types';
import { StreamController } from '@/features/chat/controllers/StreamController';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { SubagentManager } from '@/features/chat/services/SubagentManager';
import { ChatState } from '@/features/chat/state/ChatState';
import type { FeatureHost } from '@/features/FeatureHost';

HTMLElement.prototype.empty = function (): void { this.replaceChildren(); };
HTMLElement.prototype.setText = function (text: string): void { this.textContent = text; };
HTMLElement.prototype.scrollIntoView ??= () => undefined;

function createFixture(attached: boolean, providerId: ProviderId = 'claude') {
  const messages = document.body.createDiv();
  const plugin = { app: { vault: { getAbstractFileByPath: () => null, adapter: { list: async () => ({ files: [], folders: [] }) } } }, settings: { enableAutoScroll: false, mediaFolder: '' } } as unknown as FeatureHost;
  const component = new Component();
  const renderer = new MessageRenderer(plugin, component, messages);
  const state = new ChatState();
  const subagents = new SubagentManager(() => undefined);
  const controller = new StreamController({ plugin, renderer, state, subagentManager: subagents,
    getProviderId: () => providerId, getMessagesEl: () => messages, getFileContextManager: () => null, updateQueueIndicator: () => undefined });
  subagents.setCallback(info => controller.onAsyncSubagentStateChange(info));
  const message: ChatMessage = { id: 'answer', role: 'assistant', content: '', timestamp: 1, contentBlocks: [], toolCalls: [] };
  state.addMessage(message);
  if (attached) state.currentContentEl = messages.createDiv({ cls: 'claudian-message-content' });
  return { state, message, controller, renderer, messages, subagents, cleanup: () => {
    controller.dispose(); subagents.clear(); renderer.dispose(); state.resetStreamingState(); component.unload(); messages.remove();
  } };
}

it('retains ordered text and thinking blocks without a presentation', async () => {
  const fixture = createFixture(false);
  const time = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  try {
    await fixture.controller.handleStreamChunk({ type: 'text', content: 'Before ' }, fixture.message);
    await fixture.controller.handleStreamChunk({ type: 'text', content: 'thinking.' }, fixture.message);
    await fixture.controller.handleStreamChunk({ type: 'thinking', content: 'Reasoning' }, fixture.message);
    time.mockReturnValue(3_000);
    await fixture.controller.handleStreamChunk({ type: 'text', content: 'After.' }, fixture.message);
    await fixture.controller.finalizeCurrentTextBlock(fixture.message);
    expect(fixture.message.contentBlocks).toEqual([
      { id: 'answer:block:0', type: 'text', content: 'Before thinking.' },
      { id: 'answer:block:1', type: 'thinking', content: 'Reasoning', durationSeconds: 2 },
      { id: 'answer:block:2', type: 'text', content: 'After.' },
    ]);
  } finally { time.mockRestore(); fixture.cleanup(); }
});

it.each(['attached', 'absent', 'detached'] as const)('keeps the same tool, notification and response ordering with %s presentation', async presentation => {
  const fixture = createFixture(presentation !== 'absent');
  const render = jest.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, el) => { el.textContent = markdown; });
  const time = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  try {
    await fixture.controller.handleStreamChunk({ type: 'text', content: 'Before.' }, fixture.message);
    if (presentation === 'detached') {
      fixture.state.currentContentEl?.remove();
      fixture.state.currentContentEl = null;
      fixture.state.currentTextEl = null;
    }
    await fixture.controller.handleStreamChunk({ type: 'thinking', content: 'Check.' }, fixture.message);
    time.mockReturnValue(3_000);
    await fixture.controller.handleStreamChunk({ type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'note.md' } }, fixture.message);
    await fixture.controller.handleStreamChunk({ type: 'tool_output', id: 'read', content: 'partial' }, fixture.message);
    await fixture.controller.handleStreamChunk({ type: 'tool_result', id: 'read', content: 'File contents' }, fixture.message);
    if (presentation === 'detached') fixture.state.currentContentEl = fixture.messages.createDiv({ cls: 'claudian-message-content' });
    await fixture.controller.handleStreamChunk({ type: 'text', content: 'After.' }, fixture.message);
    await fixture.controller.handleStreamChunk({ type: 'task_notification', content: 'Background task finished.' }, fixture.message);
    await fixture.controller.handleStreamChunk({ type: 'text', content: 'Done.' }, fixture.message);
    await fixture.controller.finalizeCurrentTextBlock(fixture.message);
    expect(fixture.message.contentBlocks).toEqual([
      { id: 'answer:block:0', type: 'text', content: 'Before.' },
      { id: 'answer:block:1', type: 'thinking', content: 'Check.', durationSeconds: 2 },
      { id: 'answer:tool:read', type: 'tool_use', toolId: 'read' },
      { id: 'answer:block:3', type: 'text', content: 'After.' },
      { id: 'answer:block:4', type: 'task_notification', content: 'Background task finished.' },
      { id: 'answer:block:5', type: 'text', content: 'Done.' },
    ]);
    expect(fixture.message.toolCalls).toEqual([expect.objectContaining({ id: 'read', status: 'completed', result: 'File contents' })]);
    expect(fixture.message.content).toBe('Before.After.Done.');
  } finally { render.mockRestore(); time.mockRestore(); fixture.cleanup(); }
});

it.each([true, false])('retains managed subagent child tools with attached=%s', async attached => {
  const fixture = createFixture(attached);
  const render = jest.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, el) => { el.textContent = markdown; });
  try {
    await fixture.controller.handleStreamChunk({ type: 'tool_use', id: 'agent', name: 'Agent', input: { description: 'Review', prompt: 'Check files', run_in_background: false } }, fixture.message);
    await fixture.controller.handleStreamChunk({ type: 'subagent_tool_use', subagentId: 'agent', id: 'child-read', name: 'Read', input: { file_path: 'note.md' } }, fixture.message);
    await fixture.controller.handleStreamChunk({ type: 'subagent_tool_result', subagentId: 'agent', id: 'child-read', content: 'Child contents' }, fixture.message);
    await fixture.controller.handleStreamChunk({ type: 'tool_result', id: 'agent', content: 'Child done' }, fixture.message);
    expect(fixture.message.toolCalls?.[0].subagent).toEqual(expect.objectContaining({
      description: 'Review', status: 'completed', result: 'Child done',
      toolCalls: [expect.objectContaining({ id: 'child-read', status: 'completed', result: 'Child contents' })],
    }));
    expect(fixture.message.contentBlocks).toContainEqual(expect.objectContaining({ type: 'subagent', subagentId: 'agent' }));
  } finally { render.mockRestore(); fixture.cleanup(); }
});

it.each([true, false])('records async completion between text blocks with attached=%s', async attached => {
  const fixture = createFixture(attached);
  const render = jest.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, el) => { el.textContent = markdown; });
  try {
    await fixture.controller.handleStreamChunk({ type: 'tool_use', id: 'background-agent', name: 'Agent', input: { description: 'Background review', run_in_background: true } }, fixture.message);
    await fixture.controller.handleStreamChunk({ type: 'tool_result', id: 'background-agent', content: '{"agent_id":"worker"}' }, fixture.message);
    await fixture.controller.handleStreamChunk({ type: 'text', content: 'Before completion.' }, fixture.message);
    fixture.controller.applyAsyncSubagentCompletion({ type: 'async_subagent_completion', providerSessionId: 'session', taskId: 'worker', toolUseId: 'background-agent', status: 'completed', result: 'Reviewed' });
    await fixture.controller.handleStreamChunk({ type: 'text', content: 'After completion.' }, fixture.message);
    fixture.subagents.refreshAsyncSubagent(fixture.message.toolCalls![0].subagent!);
    await fixture.controller.finalizeCurrentTextBlock(fixture.message);
    expect(fixture.message.toolCalls?.[0].subagent).toEqual(expect.objectContaining({ asyncStatus: 'completed', result: 'Reviewed' }));
    expect(fixture.message.contentBlocks?.map(block => block.type === 'text' ? block.content : block.type)).toEqual([
      'Before completion.', 'subagent', 'After completion.',
    ]);
  } finally { render.mockRestore(); fixture.cleanup(); }
});

it.each([true, false])('updates Codex lifecycle subagent outcomes with attached=%s', async attached => {
  const fixture = createFixture(attached, 'codex');
  const render = jest.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, el) => { el.textContent = markdown; });
  try {
    await fixture.controller.handleStreamChunk({ type: 'tool_use', id: 'spawn', name: 'spawn_agent', input: { message: 'Review' } }, fixture.message);
    await fixture.controller.handleStreamChunk({ type: 'tool_result', id: 'spawn', content: '{"agent_id":"worker"}' }, fixture.message);
    await fixture.controller.handleStreamChunk({ type: 'tool_use', id: 'wait', name: 'wait_agent', input: { targets: ['worker'] } }, fixture.message);
    await fixture.controller.handleStreamChunk({ type: 'tool_result', id: 'wait', content: '{"status":{"worker":{"completed":"Reviewed"}},"timed_out":false}' }, fixture.message);
    expect(fixture.message.toolCalls?.[0].subagent).toEqual(expect.objectContaining({ status: 'completed', result: 'Reviewed' }));
  } finally { render.mockRestore(); fixture.cleanup(); }
});

it('continues an open text block when a presentation becomes available', async () => {
  const fixture = createFixture(false);
  const render = jest.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, el) => { el.textContent = markdown; });
  try {
    await fixture.controller.handleStreamChunk({ type: 'text', content: 'Before ' }, fixture.message);
    fixture.state.currentContentEl = fixture.messages.createDiv({ cls: 'claudian-message-content' });
    await fixture.controller.handleStreamChunk({ type: 'text', content: 'attachment.' }, fixture.message);
    await fixture.controller.finalizeCurrentTextBlock(fixture.message);
    expect(fixture.message.contentBlocks).toEqual([{ id: 'answer:block:0', type: 'text', content: 'Before attachment.' }]);
    expect(fixture.messages.textContent).toContain('Before attachment.');
  } finally { render.mockRestore(); fixture.cleanup(); }
});

it.each(['claude', 'codex', 'cursor', 'grok', 'omp', 'opencode', 'pi'] as const)('retains %s reasoning independently of its presentation policy', async providerId => {
  const fixture = createFixture(false, providerId);
  const time = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  try {
    await fixture.controller.handleStreamChunk({ type: 'thinking', content: 'Provider reasoning' }, fixture.message);
    time.mockReturnValue(2_000);
    await fixture.controller.handleStreamChunk({ type: 'text', content: 'Answer' }, fixture.message);
    await fixture.controller.finalizeCurrentTextBlock(fixture.message);
    expect(fixture.message.contentBlocks).toEqual([
      { id: 'answer:block:0', type: 'thinking', content: 'Provider reasoning', durationSeconds: 1 },
      { id: 'answer:block:1', type: 'text', content: 'Answer' },
    ]);
  } finally { time.mockRestore(); fixture.cleanup(); }
});
