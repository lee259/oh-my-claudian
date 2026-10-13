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

  it('folds settled OMP work across a whitespace-only streaming block', () => {
    const fixture = createTurn('omp');
    const { renderer, component, messagesEl, assistant, content, text, tool } = fixture;
    try {
      const thought = content.createDiv({ cls: 'claudian-thinking-block', text: 'Inspecting the plan.' });
      assistant.contentBlocks!.push({ type: 'thinking', content: 'Inspecting the plan.' });
      const read = tool('read-plan', 'completed');
      text('\n');
      const denied = tool('cancelled-command', 'completed');
      assistant.toolCalls!.at(-1)!.status = 'error';
      const edit = tool('edit-plan', 'completed');
      const answer = text('The check is complete.');
      renderer.finalizeCompletedWork(assistant);
      const history = messagesEl.querySelector<HTMLElement>('.claudian-completed-work-history')!;
      for (const element of [thought, read, denied, edit]) expect(history.contains(element)).toBe(true);
      expect(history.contains(answer)).toBe(false);
      expect(history.hidden).toBe(true);
      expect(messagesEl.querySelector('.claudian-completed-work.has-errors')).not.toBeNull();
      expect(messagesEl.contains(answer)).toBe(true);
    } finally { renderer.dispose(); component.unload(); }
  });

  it('folds OMP tool batches before a separate final assistant message', () => {
    const fixture = createTurn('omp');
    const { renderer, component, messagesEl, user, assistant, text, tool } = fixture;
    try {
      tool('read-plan', 'completed');
      text('\n');
      tool('cancelled-command', 'completed');
      assistant.toolCalls!.at(-1)!.status = 'error';
      assistant.content = '\n';
      const answer: ChatMessage = {
        id: 'continuation', role: 'assistant', content: 'The check is complete.', timestamp: 3,
        contentBlocks: [{ type: 'text', content: 'The check is complete.' }],
      };
      const source = JSON.stringify(assistant.contentBlocks);
      renderer.renderMessagesInto(messagesEl, [user, assistant, answer]);
      const history = messagesEl.querySelector<HTMLElement>('.claudian-completed-work-history')!;
      const tools = [...messagesEl.querySelectorAll<HTMLElement>('.claudian-tool-call')];
      expect(tools).toHaveLength(2);
      for (const element of tools) expect(history.contains(element)).toBe(true);
      const finalMessage = messagesEl.querySelector('[data-message-id="continuation"]')!;
      expect(finalMessage).not.toBeNull();
      expect(history.contains(finalMessage)).toBe(false);
      expect(history.hidden).toBe(true);
      expect(messagesEl.querySelector('.claudian-completed-work.has-errors')).not.toBeNull();
      messagesEl.querySelector<HTMLButtonElement>('.claudian-completed-work-header')!.click();
      expect(history.hidden).toBe(false);
      expect(JSON.stringify(assistant.contentBlocks)).toBe(source);
    } finally { renderer.dispose(); component.unload(); }
  });

  it('omits standalone periods before OMP tools without hiding final punctuation', () => {
    const fixture = createTurn('omp');
    const { renderer, component, messagesEl, user, assistant } = fixture;
    assistant.content = '.';
    assistant.contentBlocks = [
      { type: 'text', content: '.' },
      { type: 'tool_use', toolId: 'omp-placeholder-edit' },
    ];
    assistant.toolCalls = [{ id: 'omp-placeholder-edit', name: 'Bash', input: {}, status: 'completed' }];
    const final: ChatMessage = {
      id: 'period-final', role: 'assistant', content: '.', timestamp: 3,
      contentBlocks: [{ type: 'text', content: '.' }],
    };
    const source = JSON.stringify(assistant.contentBlocks);
    try {
      renderer.renderMessagesInto(messagesEl, [user, assistant, final]);
      expect(messagesEl.querySelector('[data-transcript-item-id="assistant:block:0"]')).toBeNull();
      expect(messagesEl.querySelector('[data-transcript-item-id="period-final:block:0"]')).not.toBeNull();
      expect(messagesEl.querySelectorAll('.claudian-tool-call')).toHaveLength(1);
      expect(JSON.stringify(assistant.contentBlocks)).toBe(source);
    } finally { renderer.dispose(); component.unload(); }
  });

  it('removes an OMP period when its following tool arrives during streaming', () => {
    const fixture = createTurn('omp');
    const { renderer, component, content, assistant, text, tool, sync } = fixture;
    try {
      const placeholder = text('.');
      tool('omp-progress-tool', 'completed');
      renderer.startCompletedWork(content);
      sync();
      expect(content.contains(placeholder)).toBe(false);
      expect(content.querySelectorAll('.claudian-tool-call')).toHaveLength(1);
      const answer = text('.');
      sync();
      expect(content.contains(answer)).toBe(true);
      expect(assistant.contentBlocks?.filter(b => b.type === 'text')).toHaveLength(2);
    } finally { renderer.dispose(); component.unload(); }
  });

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

  it('keeps the outer live work header noninteractive until the turn settles', () => {
    const fixture = createTurn();
    const { messagesEl, renderer, component, assistant, text, tool, sync } = fixture;
    try {
      text('Inspecting the files.');
      const read = tool('read', 'completed');
      tool('read-more', 'completed');
      renderer.startCompletedWork(fixture.content);
      text('Checking their references.');
      assistant.contentBlocks!.pop();
      sync({ type: 'text', content: 'Checking their references.' });
      let history = messagesEl.querySelector<HTMLElement>('.claudian-streaming-work-history')!;
      let header = messagesEl.querySelector<HTMLElement>('.claudian-streaming-work-header')!;
      expect(history.hidden).toBe(false);
      expect(header.tagName).toBe('DIV');
      expect(header.hasAttribute('aria-expanded')).toBe(false);
      expect(header.hasAttribute('tabindex')).toBe(false);
      expect(header.querySelector('.claudian-completed-work-indicator')).toBeNull();
      header.click();
      header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      header.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      expect(history.hidden).toBe(false);
      sync({ type: 'text', content: 'Checking more references.' });
      history = messagesEl.querySelector<HTMLElement>('.claudian-streaming-work-history')!;
      header = messagesEl.querySelector<HTMLElement>('.claudian-streaming-work-header')!;
      expect(history.hidden).toBe(false);
      expect(header.tagName).toBe('DIV');
      const phaseHeader = history.querySelector<HTMLButtonElement>('.claudian-activity-phase-header')!;
      const phaseDetails = history.querySelector<HTMLElement>('.claudian-activity-phase-details')!;
      const wasHidden = phaseDetails.hidden;
      phaseHeader.click();
      expect(phaseDetails.hidden).toBe(!wasHidden);
      expect(history.hidden).toBe(false);
      text('The final answer.');
      renderer.finalizeCompletedWork(assistant);
      const completed = messagesEl.querySelector<HTMLElement>('.claudian-completed-work-history')!;
      const completedHeader = messagesEl.querySelector<HTMLButtonElement>('.claudian-completed-work-header')!;
      expect(completed.hidden).toBe(true);
      expect(completed.contains(read)).toBe(true);
      completedHeader.click();
      expect(completed.hidden).toBe(false);
      completedHeader.click();
      expect(completed.hidden).toBe(true);
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
