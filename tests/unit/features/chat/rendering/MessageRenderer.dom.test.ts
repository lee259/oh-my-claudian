/** @jest-environment jsdom */

import '@/providers';

import { getByRole } from '@testing-library/dom';
import { Component, MarkdownRenderer } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderId } from '@/core/providers/types';
import { projectTranscript } from '@/core/transcript/TranscriptProjection';
import type { ChatMessage, ContentBlock } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import type { FeatureHost } from '@/features/FeatureHost';

HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };
HTMLElement.prototype.setText = function setText(text: string): void { this.textContent = text; };

function createTurn(
  providerId: ProviderId = 'claude',
  onSaveReply?: (markdown: string) => void,
  onFork?: (messageId: string) => Promise<void>,
) {
  const messagesEl = document.createElement('div');
  document.body.appendChild(messagesEl);
  const component = new Component();
  const renderer = new MessageRenderer(
    { app: {}, settings: {} } as FeatureHost, component, messagesEl, undefined, onFork,
    () => ProviderRegistry.getCapabilities(providerId), undefined, undefined, undefined, undefined, onSaveReply,
  );
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

  it('preserves a paused activity viewport when live tools rebuild the phase', () => {
    const { renderer, component, content, tool, sync } = createTurn();
    try {
      tool('first', 'completed'); tool('second', 'running'); sync();
      const details = content.querySelector<HTMLElement>('.claudian-activity-phase-details')!;
      Object.defineProperties(details, { scrollHeight: { value: 1200 }, clientHeight: { value: 320 } });
      details.scrollTop = 180;
      details.dispatchEvent(new Event('scroll'));
      tool('third', 'running'); sync();
      const next = content.querySelector<HTMLElement>('.claudian-activity-phase-details')!;
      expect(next).not.toBe(details);
      expect(next.scrollTop).toBe(180);
    } finally { renderer.dispose(); component.unload(); }
  });

  it.each(['settled', 'stored'] as const)('folds all %s tools across invisible thinking blocks', (mode) => {
    const { renderer, component, messagesEl, user, assistant, text, tool } = createTurn();
    try {
      tool('first-edit', 'completed');
      assistant.contentBlocks!.push({ type: 'thinking', content: '' });
      tool('second-edit', 'completed');
      text('The check is complete.');
      const source = JSON.stringify(assistant);

      if (mode === 'settled') {
        renderer.finalizeCompletedWork(assistant);
      } else {
        renderer.renderMessagesInto(messagesEl, [user, assistant]);
      }

      const fold = messagesEl.querySelector<HTMLElement>('.claudian-completed-work')!;
      const history = fold.querySelector<HTMLElement>('.claudian-completed-work-history')!;
      expect(history.querySelectorAll('.claudian-tool-call')).toHaveLength(2);
      expect([...messagesEl.querySelectorAll('.claudian-tool-call')]
        .filter((element) => !history.contains(element))).toHaveLength(0);
      expect(history.hidden).toBe(true);
      const answer = messagesEl.querySelector('.claudian-message-assistant .claudian-text-block')!;
      expect(history.contains(answer)).toBe(false);
      expect(fold.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      fold.querySelector<HTMLButtonElement>('.claudian-completed-work-header')!.click();
      expect(history.hidden).toBe(false);
      expect(JSON.stringify(assistant)).toBe(source);
    } finally { renderer.dispose(); component.unload(); }
  });

  it('saves the final Markdown answer from the action after copy and fork', () => {
    const onSave = jest.fn();
    const { renderer, component, messagesEl, assistant, text, tool } = createTurn('claude', onSave, jest.fn());
    try {
      assistant.assistantMessageId = 'native-answer';
      text('Checking the files.');
      tool('check', 'completed');
      text('# Result\n\n**Done** with [[Source]].');
      text('```ts\nconst ok = true;\n```');
      renderer.finalizeCompletedWork(assistant);
      const actions = messagesEl.querySelector<HTMLElement>('.claudian-message-action-row')!;
      const save = getByRole(actions, 'button', { name: 'Save to note' });
      expect([...actions.querySelectorAll('button')].map(button => button.className)).toEqual([
        'claudian-text-copy-btn', 'claudian-message-fork-btn', 'claudian-save-note-btn',
      ]);
      save.click();
      expect(onSave).toHaveBeenCalledWith('# Result\n\n**Done** with [[Source]].\n\n```ts\nconst ok = true;\n```');
      renderer.finalizeCompletedWork(assistant);
      expect(actions.querySelectorAll('.claudian-save-note-btn')).toHaveLength(1);
    } finally { renderer.dispose(); component.unload(); }
  });

  it.each(['claude', 'codex', 'cursor', 'grok', 'omp', 'opencode', 'pi'] as const)(
    'offers note saving for %s independently of forking', (providerId) => {
      const onSave = jest.fn();
      const { renderer, component, messagesEl, assistant, text } = createTurn(providerId, onSave);
      try {
        text('## Answer\n\n- Keep Markdown');
        expect(messagesEl.querySelector('.claudian-save-note-btn')).toBeNull();
        renderer.finalizeCompletedWork(assistant);
        getByRole(messagesEl, 'button', { name: 'Save to note' }).click();
        expect(onSave).toHaveBeenCalledWith('## Answer\n\n- Keep Markdown');
      } finally { renderer.dispose(); component.unload(); }
    },
  );

  it('saves restored legacy text and preserves answer text around citations', () => {
    const onSave = jest.fn();
    const { renderer, component, messagesEl } = createTurn('claude', onSave);
    try {
      renderer.renderStoredMessage({ id: 'legacy', role: 'assistant', content: '# Legacy answer', timestamp: 3 });
      getByRole(messagesEl.querySelector<HTMLElement>('[data-message-id="legacy"]')!, 'button', { name: 'Save to note' }).click();
      expect(onSave).toHaveBeenLastCalledWith('# Legacy answer');
      renderer.renderStoredMessage({
        id: 'cited', role: 'assistant', content: '', timestamp: 4,
        contentBlocks: [
          { type: 'thinking', content: 'Private reasoning' },
          { type: 'text', content: '# Answer' },
          { type: 'citations', citations: { kind: 'memory', entries: [] } },
          { type: 'text', content: '| Key | Value |\n| --- | --- |\n| Ready | Yes |' },
        ],
      });
      getByRole(messagesEl.querySelector<HTMLElement>('[data-message-id="cited"]')!, 'button', { name: 'Save to note' }).click();
      expect(onSave).toHaveBeenLastCalledWith('# Answer\n\n| Key | Value |\n| --- | --- |\n| Ready | Yes |');
    } finally { renderer.dispose(); component.unload(); }
  });

  it.each(['work-only', 'interrupted', 'empty'] as const)('does not offer saving for a %s reply', (kind) => {
    const { renderer, component, messagesEl, assistant, text, tool } = createTurn('claude', jest.fn());
    try {
      if (kind !== 'empty') text('Checking the files.');
      else assistant.content = '';
      if (kind === 'work-only') tool('check', 'completed');
      if (kind === 'interrupted') assistant.isInterrupt = true;
      renderer.finalizeCompletedWork(assistant);
      expect(messagesEl.querySelector('.claudian-save-note-btn')).toBeNull();
    } finally { renderer.dispose(); component.unload(); }
  });

  it('keeps an explicitly opened phase and exposes tool errors when live work settles', () => {
    const { renderer, component, messagesEl, assistant, content, text, tool, sync } = createTurn();
    try {
      text('Checking the files.');
      tool('check', 'running');
      tool('second-check', 'completed');
      renderer.startCompletedWork(content);
      sync({ type: 'text', content: 'Checking more references.' });
      let phase = messagesEl.querySelector<HTMLButtonElement>('.claudian-activity-phase-header')!;
      if (phase.getAttribute('aria-expanded') === 'true') phase.click();
      phase.click();
      assistant.toolCalls![0].status = 'error';
      sync({ type: 'text', content: 'Checking more references.' });
      const liveHeader = messagesEl.querySelector<HTMLElement>('.claudian-streaming-work-header')!;
      expect(getByRole(liveHeader, 'img', { name: /1 error/ })).not.toBeNull();
      text('The check found a problem.');
      renderer.finalizeCompletedWork(assistant);
      const completed = messagesEl.querySelector<HTMLElement>('.claudian-completed-work')!;
      expect(getByRole(completed, 'button', { name: /1 error.*Completed/ })).not.toBeNull();
      phase = completed.querySelector<HTMLButtonElement>('.claudian-activity-phase-header')!;
      expect(phase.getAttribute('aria-expanded')).toBe('true');
      expect(completed.querySelector<HTMLElement>('.claudian-completed-work-history')!.hidden).toBe(false);
      expect(getByRole(phase, 'img', { name: /1 error/ })).not.toBeNull();
    } finally { renderer.dispose(); component.unload(); }
  });

  it.each(['live', 'stored'] as const)('keeps image-only %s prompts addressable with their attachments and timestamp', (mode) => {
    const { renderer, component, messagesEl } = createTurn();
    const message: ChatMessage = {
      id: 'image-prompt', role: 'user', content: '', timestamp: 1000,
      images: [{ id: 'image', name: 'screenshot.png', mediaType: 'image/png', data: 'YWJj', size: 3, source: 'paste' }],
    };
    try {
      if (mode === 'live') renderer.addMessage(message);
      else renderer.renderStoredMessage(message);
      const shell = messagesEl.querySelector<HTMLElement>('[data-message-id="image-prompt"]')!;
      expect(shell).not.toBeNull();
      expect(shell.querySelectorAll('.claudian-message-image')).toHaveLength(1);
      expect(shell.querySelector('.claudian-message-timestamp')).not.toBeNull();
      expect(shell.getAttribute('data-toc-title')).toBe('screenshot.png');
      expect(shell.querySelector('.claudian-message-content')?.textContent).toBe('');
    } finally { renderer.dispose(); component.unload(); }
  });

  it('reopens completed work when a collapse is reversed before its animation finishes', () => {
    const { renderer, component, messagesEl, assistant, tool, text } = createTurn();
    try {
      tool('read', 'completed');
      text('The check is complete.');
      renderer.finalizeCompletedWork(assistant);
      const header = messagesEl.querySelector<HTMLButtonElement>('.claudian-completed-work-header')!;
      const history = messagesEl.querySelector<HTMLElement>('.claudian-completed-work-history')!;
      const animations: Array<{ cancel: jest.Mock; onfinish?: () => void }> = [];
      Object.defineProperty(history, 'animate', { value: jest.fn(() => {
        const animation = { cancel: jest.fn() };
        animations.push(animation);
        return animation;
      }) });
      header.click();
      animations.at(-1)!.onfinish?.();
      header.click();
      header.click();
      animations.at(-1)!.onfinish?.();
      expect(header.getAttribute('aria-expanded')).toBe('true');
      expect(history.hidden).toBe(false);
    } finally { renderer.dispose(); component.unload(); }
  });

  it('scrolls to the latest message when a hidden tab is revealed', () => {
    const pane = document.createElement('div');
    pane.classList.add('claudian-hidden');
    const messagesEl = pane.createDiv();
    document.body.appendChild(pane);

    let scrollTop = 0;
    Object.defineProperties(messagesEl, {
      clientHeight: {
        configurable: true,
        get: () => pane.classList.contains('claudian-hidden') ? 0 : 400,
      },
      scrollHeight: {
        configurable: true,
        get: () => pane.classList.contains('claudian-hidden') ? 0 : 1000,
      },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          if (!pane.classList.contains('claudian-hidden')) {
            scrollTop = Math.min(value, messagesEl.scrollHeight - messagesEl.clientHeight);
          }
        },
      },
    });

    const resizeObserverDescriptor = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
    const callbacks: ResizeObserverCallback[] = [];
    class TestResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() { callbacks.push(this.callback); }
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: TestResizeObserver,
    });

    const component = new Component();
    const renderer = new MessageRenderer(
      { app: {}, settings: {} } as FeatureHost,
      component,
      messagesEl,
      undefined,
      undefined,
      () => ProviderRegistry.getCapabilities('claude'),
    );
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    try {
      renderer.renderMessages([{
        id: 'latest',
        role: 'assistant',
        content: 'Latest answer',
        timestamp: 2,
        contentBlocks: [{ type: 'text', content: 'Latest answer' }],
      }], () => 'Hello');

      expect(scrollTop).toBe(0);
      pane.classList.remove('claudian-hidden');
      callbacks.forEach(callback => callback([], {} as ResizeObserver));

      expect(scrollTop).toBe(600);
    } finally {
      renderer.dispose();
      component.unload();
      if (resizeObserverDescriptor) {
        Object.defineProperty(window, 'ResizeObserver', resizeObserverDescriptor);
      } else {
        Reflect.deleteProperty(window, 'ResizeObserver');
      }
    }
  });

  it('preserves hyphens in code language labels', async () => {
    const messagesEl = document.createElement('div');
    document.body.appendChild(messagesEl);
    const component = new Component();
    const renderer = new MessageRenderer({ app: {}, settings: {} } as FeatureHost, component, messagesEl);
    (MarkdownRenderer.render as jest.Mock).mockImplementationOnce(async (_app, _markdown, element: HTMLElement) => {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = 'language-objective-c';
      code.textContent = 'int main(void) {}';
      pre.appendChild(code);
      element.appendChild(pre);
    });
    try {
      await renderer.renderContent(messagesEl, 'Objective-C example');
      expect(messagesEl.querySelector('.claudian-code-language')?.textContent).toBe('objective-c');
    } finally { renderer.dispose(); component.unload(); }
  });

  it.each([true, false])('keeps code copy controls outside code text with streaming=%s', async (streaming) => {
    const { renderer, component, content } = createTurn();
    const writeText = jest.fn().mockResolvedValue(undefined);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const source = 'const value = "a long first line";';
    (MarkdownRenderer.render as jest.Mock).mockImplementationOnce(async (_app, _markdown, element: HTMLElement) => {
      const pre = element.createEl('pre');
      pre.createEl('code', { cls: 'language-typescript', text: source });
      pre.createEl('button', { cls: 'copy-code-button' });
    });
    try {
      await renderer.renderContent(content, `\`\`\`typescript\n${source}\n\`\`\``, { deferDiagrams: streaming });
      const pre = content.querySelector('pre')!;
      const header = content.querySelector<HTMLElement>('.claudian-code-header')!;
      expect(header).not.toBeNull();
      expect(header.parentElement).toBe(pre.parentElement);
      expect(header.nextElementSibling).toBe(pre);
      expect(pre.querySelector('button')).toBeNull();
      getByRole<HTMLButtonElement>(header, 'button', { name: 'Copy typescript code' }).click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith(source);
    } finally {
      renderer.dispose(); component.unload();
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

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

  it('preserves an expanded live activity phase after the turn settles', () => {
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
      expect(completed.hidden).toBe(false);
      expect(completed.contains(read)).toBe(true);
      expect(completed.querySelector<HTMLElement>('.claudian-activity-phase-details')?.hidden).toBe(false);
      completedHeader.click();
      expect(completed.hidden).toBe(true);
      completedHeader.click();
      expect(completed.hidden).toBe(false);
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
