/** @jest-environment jsdom */

import '@/providers';

import { Component } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderId } from '@/core/providers/types';
import { projectTranscript } from '@/core/transcript/TranscriptProjection';
import type { ChatMessage, ContentBlock } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import type { FeatureHost } from '@/features/FeatureHost';

HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };
HTMLElement.prototype.setText = function setText(text: string): void { this.textContent = text; };

function createTurn(providerId: ProviderId = 'claude') {
  const messagesEl = document.createElement('div');
  document.body.appendChild(messagesEl);
  const component = new Component();
  const renderer = new MessageRenderer({ app: {}, settings: {} } as FeatureHost, component, messagesEl, undefined, undefined, () => ProviderRegistry.getCapabilities(providerId));
  const user: ChatMessage = { id: 'user', role: 'user', content: 'Check the files.', timestamp: 1 };
  const assistant: ChatMessage = {
    id: 'assistant', role: 'assistant', content: 'The check is complete.', timestamp: 2,
    contentBlocks: [], toolCalls: [],
  };
  messagesEl.createDiv({ cls: 'claudian-message claudian-message-user', attr: { 'data-message-id': user.id } });
  const content = messagesEl.createDiv({
    cls: 'claudian-message claudian-message-assistant', attr: { 'data-message-id': assistant.id },
  }).createDiv({ cls: 'claudian-message-content' });
  const text = (value: string) => {
    const el = content.createDiv({ cls: 'claudian-text-block', text: value });
    assistant.contentBlocks!.push({ type: 'text', content: value });
    return el;
  };
  const tool = (id: string, status: 'completed' | 'running', background = false) => {
    const el = content.createDiv({ cls: 'claudian-tool-call', attr: { 'data-tool-id': id } });
    el.createSpan({ cls: 'claudian-tool-name', text: 'Bash' });
    assistant.toolCalls!.push({ id, name: 'Bash', input: { run_in_background: background }, status });
    assistant.contentBlocks!.push({ type: 'tool_use', toolId: id });
    return el;
  };
  const sync = (liveBlock?: Extract<ContentBlock, { type: 'text' | 'thinking' }>) => renderer.syncStreamingActivity(
    assistant, content, liveBlock, [user, assistant],
  );
  return { messagesEl, component, renderer, user, assistant, content, text, tool, sync };
}

describe('MessageRenderer live turn disclosure in a real DOM', () => {
  afterEach(() => document.body.replaceChildren());

  it('omits Codex reasoning status from hydrated work without changing source blocks', () => {
    const fixture = createTurn('codex');
    const { renderer, component, messagesEl, user, assistant } = fixture;
    assistant.contentBlocks = [
      { type: 'text', content: 'Inspecting files.' },
      { type: 'thinking', content: 'Reviewing required guidance' },
      { type: 'text', content: 'The check is complete.' },
      { type: 'thinking', content: 'Checking references' },
    ];
    const source = JSON.stringify(assistant);
    try {
      renderer.renderMessagesInto(messagesEl, [user, assistant]);
      expect(messagesEl.querySelector('.claudian-thinking-block')).toBeNull();
      expect(messagesEl.textContent).not.toContain('Reviewing required guidance');
      expect(messagesEl.textContent).not.toContain('Checking references');
      expect(JSON.stringify(assistant)).toBe(source);
    } finally { renderer.dispose(); component.unload(); }
  });

  it('keeps the current Codex status outside the expandable work history', () => {
    const fixture = createTurn('codex');
    const { renderer, component, content, text, tool, sync } = fixture;
    try {
      text('Inspecting files.');
      tool('sample-read', 'completed');
      renderer.startCompletedWork(content);
      const status = content.createDiv({ cls: 'claudian-reasoning-status', text: 'Checking references' });
      status.dataset.transcriptItemId = 'assistant:block:2';
      sync({ type: 'thinking', content: 'Checking references' });
      expect(content.querySelector('.claudian-streaming-work-history')?.contains(status)).not.toBe(true);
      expect(status.parentElement).toBe(content);
    } finally { renderer.dispose(); component.unload(); }
  });

  it('starts expanded and preserves a manual collapse across later stream updates', () => {
    const fixture = createTurn();
    const { messagesEl, renderer, component, assistant, text, tool, sync } = fixture;
    try {
      text('Inspecting the files.');
      tool('read', 'completed');
      renderer.startCompletedWork(fixture.content);
      text('Checking their references.');
      assistant.contentBlocks!.pop();
      sync({ type: 'text', content: 'Checking their references.' });
      const history = messagesEl.querySelector<HTMLElement>('.claudian-streaming-work-history')!;
      expect(history.hidden).toBe(false);
      messagesEl.querySelector<HTMLButtonElement>('.claudian-streaming-work-header')!.click();
      expect(history.hidden).toBe(true);
      sync({ type: 'text', content: 'Checking more references.' });
      expect(messagesEl.querySelector<HTMLElement>('.claudian-streaming-work-history')!.hidden).toBe(true);
      messagesEl.querySelector<HTMLButtonElement>('.claudian-streaming-work-header')!.click();
      expect(messagesEl.querySelector<HTMLElement>('.claudian-streaming-work-history')!.hidden).toBe(false);
    } finally {
      renderer.dispose();
      component.unload();
    }
  });

  it('settles completed background and trailing work before the answer, keeping pending work visible', () => {
    const fixture = createTurn();
    const { messagesEl, renderer, component, user, assistant, content, text, tool, sync } = fixture;
    try {
      text('Inspecting the files.');
      const read = tool('read', 'completed');
      renderer.startCompletedWork(content);
      sync();
      text('Starting the background check.');
      const background = tool('background', 'completed', true);
      sync();
      const answer = text('The check is complete.');
      const tail = tool('late-command', 'completed');
      const thought = content.createDiv({ cls: 'claudian-thinking-block', text: 'Verifying the result.' });
      assistant.contentBlocks!.push({ type: 'thinking', content: 'Verifying the result.' });
      const running = tool('still-running', 'running', true);
      const pending = content.createDiv({ cls: 'claudian-ask-question-inline', text: 'Confirm the next step?' });
      sync();
      const turn = projectTranscript([user, assistant])[0];
      renderer.finalizeTranscriptTurn(turn, assistant.id);
      const fold = messagesEl.querySelector<HTMLElement>('.claudian-completed-work')!;
      const history = fold.querySelector<HTMLElement>('.claudian-completed-work-history')!;
      expect(history.hidden).toBe(true);
      for (const element of [read, background, tail, thought]) expect(history.contains(element)).toBe(true);
      for (const element of [answer, running, pending]) {
        expect(messagesEl.contains(element)).toBe(true);
        expect(history.contains(element)).toBe(false);
      }
      expect(fold.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(messagesEl.querySelectorAll('.claudian-tool-call')).toHaveLength(4);
      expect(messagesEl.querySelectorAll('.claudian-completed-work')).toHaveLength(1);
      fold.querySelector<HTMLButtonElement>('.claudian-completed-work-header')!.click();
      expect(history.hidden).toBe(false);
    } finally {
      renderer.dispose();
      component.unload();
    }
  });
});
