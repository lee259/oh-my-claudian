import { setIcon } from 'obsidian';

import type { ChatMessage } from '@/core/types';
import { SubagentTranscriptPanel } from '@/features/chat/ui/SubagentTranscriptPanel';

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

function createMockChild(): MockElement {
  const el: MockElement = {
    tagName: 'DIV',
    children: [],
    dataset: {},
    style: {},
    classes: new Set<string>(),
    parent: null,
    textContent: '',
    isConnected: true,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    listeners: {} as Record<string, Array<(...args: any[]) => void>>,
    focus: jest.fn(),
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
    removeAttribute(name: string) {
      delete this.dataset[name.replace(/^data-/, '')];
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
      this.isConnected = false;
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
      this.dispatchEvent({
        type: 'click',
        target: this,
        stopPropagation: () => {},
        preventDefault: () => {},
      });
    },
    get classesSet() {
      return this.classes;
    },
    ownerDocument: {
      activeElement: null,
      body: null,
      defaultView: {
        setTimeout: (fn: () => void) => setTimeout(fn, 0) as unknown as number,
        clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
    },
  };
  return el;
}

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
    hostEl = createMockChild();
    panel = new SubagentTranscriptPanel(hostEl);
  });

  afterEach(() => {
    panel.destroy();
  });

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

    it('exposes the overlay as a dialog and the back bar as a button', () => {
      panel.open({ description: 'task', status: 'running' });

      const root = hostEl.children[0];
      expect(root.getAttribute('role')).toBe('dialog');
      const backBar = getByClass(root, 'claudian-subagent-transcript-backbar');
      expect(backBar.getAttribute('role')).toBe('button');
      expect(backBar.getAttribute('tabindex')).toBe('0');
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

    it('Escape closes the panel and invokes the back callback', () => {
      const onBack = jest.fn();
      panel.setBackHandler(onBack);
      panel.open({ description: 'task', status: 'running' });

      const root = hostEl.children[0];
      const preventDefault = jest.fn();
      root.dispatchEvent(
        { type: 'keydown' },
        {
          key: 'Escape',
          target: root,
          preventDefault,
          stopPropagation: () => {},
        },
      );

      expect(preventDefault).toHaveBeenCalled();
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(panel.isOpen()).toBe(false);
    });

    it('moves focus to the back bar on open and restores the previous focus on close', () => {
      const previousFocus = jest.fn();
      const previousEl = {
        ...createMockChild(),
        focus: previousFocus,
      };
      hostEl.ownerDocument.activeElement = previousEl;

      panel.open({ description: 'task', status: 'running' });
      const backBar = getByClass(hostEl, 'claudian-subagent-transcript-backbar')!;
      expect(backBar.focus).toHaveBeenCalledTimes(1);

      panel.close();
      expect(previousFocus).toHaveBeenCalledTimes(1);
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

    it('keeps only the current status class on the status icon element', () => {
      panel.open({ description: 'task', status: 'running' });
      const icon = getByClass(hostEl, 'claudian-subagent-transcript-status-icon')!;
      expect(icon.hasClass('status-running')).toBe(true);
      expect(icon.hasClass('status-completed')).toBe(false);

      panel.setStatus('completed');
      expect(icon.hasClass('status-running')).toBe(false);
      expect(icon.hasClass('status-completed')).toBe(true);
      expect(icon.hasClass('status-error')).toBe(false);
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

    it('skips rebuilding the DOM when the transcript content is unchanged', () => {
      const renderMessages = jest.fn((container: MockElement, messages: ChatMessage[]) => {
        for (const message of messages) {
          container.createDiv({ cls: `row-${message.id}` });
        }
      });
      panel.setMessageRenderer(renderMessages);
      panel.open({ description: 'task', status: 'running' });

      const messages = [
        mockMessage({ id: 'u1', role: 'user', content: 'fix bug' }),
        mockMessage({ id: 'a1', role: 'assistant', content: 'done' }),
      ];
      panel.renderMessages(messages);
      panel.renderMessages(messages);
      panel.renderMessages(messages);

      expect(renderMessages).toHaveBeenCalledTimes(1);
      const container = renderMessages.mock.calls[0][0];
      expect(container.children.length).toBe(2);
      expect(container.hasClass('claudian-subagent-transcript-messages')).toBe(true);
    });

    it('re-renders when the transcript gains new messages', () => {
      const renderMessages = jest.fn();
      panel.setMessageRenderer(renderMessages);
      panel.open({ description: 'task', status: 'running' });

      panel.renderMessages([mockMessage({ id: 'u1', role: 'user', content: 'hi' })]);
      panel.renderMessages([
        mockMessage({ id: 'u1', role: 'user', content: 'hi' }),
        mockMessage({ id: 'a1', role: 'assistant', content: 'done' }),
      ]);

      expect(renderMessages).toHaveBeenCalledTimes(2);
    });

    it('shows an empty state when the transcript has no entries', () => {
      panel.open({ description: 'task', status: 'completed' });
      panel.renderMessages([]);

      const root = hostEl.children[0];
      const empty = getByClass(root, 'claudian-subagent-transcript-empty');
      expect(empty).toBeTruthy();
    });

    it('re-renders after an empty state once content arrives', () => {
      const renderMessages = jest.fn();
      panel.setMessageRenderer(renderMessages);
      panel.open({ description: 'task', status: 'running' });

      panel.renderMessages([]);
      expect(renderMessages).not.toHaveBeenCalled();

      const messages = [mockMessage({ id: 'a1', role: 'assistant', content: 'now ready' })];
      panel.renderMessages(messages);
      expect(renderMessages).toHaveBeenCalledTimes(1);
    });
  });

  describe('scroll position restore', () => {
    // Real DOM grows scrollHeight when rows render; the mock does not, so the
    // renderer emulates layout by deriving the height from the row count.
    const rowHeightPx = 100;
    const growingRenderer = () => {
      return jest.fn((container: MockElement, msgs: ChatMessage[]) => {
        for (const message of msgs) {
          container.createDiv({ cls: `row-${message.id}` });
        }
        container.scrollHeight = msgs.length * rowHeightPx;
      });
    };
    const longTranscript = Array.from({ length: 10 }, (_, index) => (
      mockMessage({ id: `a${index + 1}`, role: 'assistant', content: `msg ${index + 1}` })
    ));

    it('follows new content when the reader is pinned to the bottom', () => {
      const renderMessages = growingRenderer();
      panel.setMessageRenderer(renderMessages);
      panel.open({ description: 'task', status: 'running' });

      panel.renderMessages(longTranscript);
      const container = renderMessages.mock.calls[0][0];
      container.scrollTop = 900;
      container.clientHeight = 100;

      panel.renderMessages([
        ...longTranscript,
        mockMessage({ id: 'a11', role: 'assistant', content: 'msg 11' }),
        mockMessage({ id: 'a12', role: 'assistant', content: 'msg 12' }),
      ]);

      expect(container.scrollTop).toBe(1200);
    });

    it('keeps a scrolled-up reader anchored when content is appended below', () => {
      const renderMessages = growingRenderer();
      panel.setMessageRenderer(renderMessages);
      panel.open({ description: 'task', status: 'running' });

      panel.renderMessages(longTranscript);
      const container = renderMessages.mock.calls[0][0];
      container.scrollTop = 300;
      container.clientHeight = 100;

      panel.renderMessages([
        ...longTranscript,
        mockMessage({ id: 'a11', role: 'assistant', content: 'msg 11' }),
        mockMessage({ id: 'a12', role: 'assistant', content: 'msg 12' }),
        mockMessage({ id: 'a13', role: 'assistant', content: 'msg 13' }),
      ]);

      // Growth of 300px below the reader must not drag them toward the bottom.
      expect(container.scrollTop).toBe(300);
    });

    it('leaves the scroll position untouched on the first render', () => {
      const renderMessages = jest.fn((container: MockElement, msgs: ChatMessage[]) => {
        for (const message of msgs) {
          container.createDiv({ cls: `row-${message.id}` });
        }
      });
      panel.setMessageRenderer(renderMessages);
      panel.open({ description: 'task', status: 'running' });

      panel.renderMessages([mockMessage({ id: 'a1', role: 'assistant', content: 'one' })]);

      const container = renderMessages.mock.calls[0][0];
      expect(container.scrollTop).toBe(0);
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

    it('clears the cached signature so the next render is not skipped', () => {
      const renderMessages = jest.fn();
      panel.setMessageRenderer(renderMessages);
      panel.open({ description: 'task', status: 'running' });

      const messages = [mockMessage({ id: 'a1', role: 'assistant', content: 'done' })];
      panel.renderMessages(messages);
      expect(renderMessages).toHaveBeenCalledTimes(1);

      panel.showUnavailable();
      panel.renderMessages(messages);
      expect(renderMessages).toHaveBeenCalledTimes(2);
    });
  });
});
