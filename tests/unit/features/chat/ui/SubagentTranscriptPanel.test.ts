import { setIcon } from 'obsidian';

import type { ChatMessage } from '@/core/types';
import {
  SubagentTranscriptPanel,
  type TranscriptEntryView,
} from '@/features/chat/ui/SubagentTranscriptPanel';

// Shared obsidian mock (setIcon is also provided globally by the obsidian mock).
jest.mock('obsidian', () => ({
  setIcon: jest.fn((el: any, icon: string) => {
    el.setAttribute('data-icon', icon);
  }),
  Notice: jest.fn(),
}));

type MockElement = any;

const getByClass = (el: MockElement, cls: string): MockElement | null => {
  if (el.hasClass?.(cls)) return el;
  for (const child of el.children ?? []) {
    const found = getByClass(child, cls);
    if (found) return found;
  }
  return null;
};

const getTextsByClass = (el: MockElement, cls: string): string[] => {
  const out: string[] = [];
  const visit = (node: MockElement) => {
    if (node.hasClass?.(cls)) out.push(node.textContent ?? '');
    (node.children ?? []).forEach(visit);
  };
  visit(el);
  return out;
};

const mockMessage = (partial: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  role: 'user',
  content: 'hello',
  timestamp: 1000,
  ...partial,
});

describe('SubagentTranscriptPanel', () => {
  let hostEl: MockElement;
  let panel: SubagentTranscriptPanel;

  beforeEach(() => {
    jest.clearAllMocks();
    hostEl = {
      tagName: 'DIV',
      children: [],
      dataset: {},
      style: {},
      addClass: jest.fn(),
      removeClass: jest.fn(),
      hasClass: jest.fn(() => false),
      toggleClass: jest.fn(),
      setAttribute: jest.fn(),
      getAttribute: jest.fn(() => null),
      appendChild(child: MockElement) {
        this.children.push(child);
        child.parent = this;
        return child;
      },
      createDiv(opts?: { cls?: string; text?: string }) {
        const child = createMockChild();
        if (opts?.cls) child.addClass(opts.cls);
        if (opts?.text) child.textContent = opts.text;
        this.appendChild(child);
        return child;
      },
      ownerDocument: {
        defaultView: {
          setTimeout: (fn: () => void) => setTimeout(fn, 0) as unknown as number,
          clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
        },
      },
    };
    panel = new SubagentTranscriptPanel(hostEl);
  });

  afterEach(() => {
    panel.destroy();
  });

  function createMockChild(): MockElement {
    const el: MockElement = {
      tagName: 'DIV',
      children: [],
      dataset: {},
      style: {},
      classes: new Set<string>(),
      parent: null,
      textContent: '',
      listeners: {} as Record<string, Array<(...args: any[]) => void>>,
      addClass(cls: string) {
        cls.split(/\s+/).filter(Boolean).forEach((c: string) => this.classes.add(c));
      },
      removeClass(cls: string) {
        cls.split(/\s+/).filter(Boolean).forEach((c: string) => this.classes.delete(c));
      },
      hasClass(cls: string) {
        return this.classes.has(cls);
      },
      toggleClass(cls: string, force: boolean) {
        if (force === undefined) {
          if (this.classes.has(cls)) this.classes.delete(cls);
          else this.classes.add(cls);
        } else if (force) {
          this.classes.add(cls);
        } else {
          this.classes.delete(cls);
        }
      },
      setAttribute(name: string, value: string) {
        this.dataset[name.replace(/^data-/, '')] = value;
      },
      getAttribute(name: string) {
        return this.dataset[name.replace(/^data-/, '')] ?? null;
      },
      appendChild(child: MockElement) {
        child.parent = this;
        this.children.push(child);
        return child;
      },
      remove() {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter((c: MockElement) => c !== this);
        this.parent = null;
      },
      empty() {
        this.children = [];
      },
      setText(text: string) {
        this.textContent = text;
      },
      createDiv(opts?: { cls?: string; text?: string }) {
        const child = createMockChild();
        if (opts?.cls) child.addClass(opts.cls);
        if (opts?.text) child.textContent = opts.text;
        this.appendChild(child);
        return child;
      },
      addEventListener(event: string, handler: (...args: any[]) => void) {
        (this.listeners[event] ??= []).push(handler);
      },
      dispatchEvent(event: string | { type: string }, payload?: any) {
        const type = typeof event === 'string' ? event : event.type;
        (this.listeners[type] ?? []).forEach((h: (...args: any[]) => void) =>
          h(payload ?? { type, target: this, stopPropagation: () => {}, preventDefault: () => {} }),
        );
      },
      click() {
        this.dispatchEvent({ type: 'click', target: this, stopPropagation: () => {}, preventDefault: () => {} });
      },
      get classesSet() {
        return this.classes;
      },
      ownerDocument: {
        defaultView: {
          setTimeout: (fn: () => void) => setTimeout(fn, 0) as unknown as number,
          clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
        },
      },
    };
    return el;
  }

  describe('open/close lifecycle', () => {
    it('is closed by default and does not create DOM until opened', () => {
      expect(panel.isOpen()).toBe(false);
      expect(hostEl.children.length).toBe(0);
    });

    it('creates a visible overlay with a back bar when opened', () => {
      panel.open({ description: 'Write tests', status: 'running' });

      expect(panel.isOpen()).toBe(true);
      const root = hostEl.children[0];
      expect(root.hasClass('claudian-subagent-transcript')).toBe(true);
      expect(root.classes.has('claudian-hidden')).toBe(false);

      const backBar = getByClass(root, 'claudian-subagent-transcript-backbar');
      expect(backBar).toBeTruthy();

      const titles = getTextsByClass(root, 'claudian-subagent-transcript-title');
      expect(titles).toContain('Write tests');
    });

    it('hides overlay again on close()', () => {
      panel.open({ description: 'task', status: 'completed' });
      expect(panel.isOpen()).toBe(true);

      panel.close();
      expect(panel.isOpen()).toBe(false);
      expect(hostEl.children[0].classes.has('claudian-hidden')).toBe(true);
    });

    it('back bar click invokes the registered back callback', () => {
      const onBack = jest.fn();
      panel.setBackHandler(onBack);
      panel.open({ description: 'task', status: 'running' });

      const root = hostEl.children[0];
      const backBar = getByClass(root, 'claudian-subagent-transcript-backbar')!;
      backBar.click();

      expect(onBack).toHaveBeenCalledTimes(1);
      expect(panel.isOpen()).toBe(false);
    });
  });

  describe('status display', () => {
    it('shows running status text with a loading icon while running', () => {
      panel.open({ description: 'task', status: 'running' });
      const texts = getTextsByClass(hostEl, 'claudian-subagent-transcript-status');
      expect(texts.join(' ').toLowerCase()).toContain('running');
      expect(setIcon).toHaveBeenCalledWith(
        expect.objectContaining({}),
        expect.stringMatching(/loader|activity/),
      );
    });

    it('updates status text and icon when status changes', () => {
      panel.open({ description: 'task', status: 'running' });
      panel.setStatus('completed');
      const texts = getTextsByClass(hostEl, 'claudian-subagent-transcript-status');
      expect(texts.join(' ').toLowerCase()).toContain('completed');
    });
  });

  describe('read-only transcript rendering', () => {
    it('renders user and assistant messages through the injected renderer', () => {
      const renderMessages = jest.fn();
      panel.setMessageRenderer(renderMessages);
      panel.open({ description: 'task', status: 'completed' });

      const messages = [
        mockMessage({ id: 'u1', role: 'user', content: 'fix bug' }),
        mockMessage({ id: 'a1', role: 'assistant', content: 'done' }),
      ];
      panel.renderMessages(messages);

      expect(renderMessages).toHaveBeenCalledTimes(1);
      const container = renderMessages.mock.calls[0][0];
      expect(container.hasClass('claudian-subagent-transcript-messages')).toBe(true);
      expect(renderMessages.mock.calls[0][1]).toEqual(messages);
    });

    it('shows an empty state when the transcript has no entries', () => {
      panel.open({ description: 'task', status: 'completed' });
      panel.renderMessages([]);

      const root = hostEl.children[0];
      const empty = getByClass(root, 'claudian-subagent-transcript-empty');
      expect(empty).toBeTruthy();
    });
  });

  describe('type-level helpers (TranscriptEntryView)', () => {
    it('supports a read-only entry view shape', () => {
      const entry: TranscriptEntryView = {
        messageId: 'x',
        role: 'user',
        content: 'hi',
        toolCalls: [],
      };
      expect(entry.messageId).toBe('x');
      expect(entry.role).toBe('user');
    });
  });

  describe('error / unavailable state', () => {
    it('renders an unavailable message when no sidecar transcript exists', () => {
      panel.open({ description: 'task', status: 'running' });
      panel.showUnavailable();

      const root = hostEl.children[0];
      const unavail = getByClass(root, 'claudian-subagent-transcript-unavailable');
      expect(unavail).toBeTruthy();
    });
  });
});
