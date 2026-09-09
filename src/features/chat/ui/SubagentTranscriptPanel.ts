import { setIcon } from 'obsidian';

import type { ChatMessage, ToolCallInfo } from '../../../core/types';
import { t } from '../../../i18n/i18n';

export type TranscriptMessageRenderer = (
  containerEl: HTMLElement,
  messages: ChatMessage[],
) => void;

export interface SubagentTranscriptPanelOptions {
  /** Human-readable subagent task description shown in the panel heading. */
  description?: string;
  /** Live status string (running/completed/error/orphaned). */
  status?: 'running' | 'completed' | 'error' | 'orphaned';
}

const STATUS_LABEL_KEYS: Record<
  NonNullable<SubagentTranscriptPanelOptions['status']>,
  'chat.subagentTranscript.runningLabel'
  | 'chat.subagentTranscript.completedLabel'
  | 'chat.subagentTranscript.errorLabel'
  | 'chat.subagentTranscript.orphanedLabel'
> = {
  running: 'chat.subagentTranscript.runningLabel',
  completed: 'chat.subagentTranscript.completedLabel',
  error: 'chat.subagentTranscript.errorLabel',
  orphaned: 'chat.subagentTranscript.orphanedLabel',
};

const STATUS_ICONS: Record<NonNullable<SubagentTranscriptPanelOptions['status']>, string> = {
  running: 'loader-2',
  completed: 'check',
  error: 'x',
  orphaned: 'alert-circle',
};

/** Keep the viewport pinned to the bottom within this many px. */
const SCROLL_FOLLOW_THRESHOLD_PX = 24;

/**
 * A per-tab overlay panel that shows a read-only transcript of one async
 * subagent while the live main conversation keeps streaming underneath.
 *
 * The panel owns only its DOM shell and status state. Rendering transcript
 * {@link ChatMessage}s is delegated to {@link setMessageRenderer} so the
 * host can reuse the app's stored-message rendering pipeline; data loading is
 * the responsibility of the wiring layer, which calls {@link renderMessages}.
 */
export class SubagentTranscriptPanel {
  private hostEl: HTMLElement;
  private rootEl: HTMLElement | null = null;
  private statusTextEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private backBarEl: HTMLElement | null = null;
  private messagesContainerEl: HTMLElement | null = null;
  private renderer: TranscriptMessageRenderer | null = null;
  private backHandler: (() => void) | null = null;
  private status: NonNullable<SubagentTranscriptPanelOptions['status']> = 'running';
  private lastRenderedSignature: string | null = null;
  private previouslyFocusedEl: HTMLElement | null = null;
  private pendingDescription: string | null = null;

  constructor(hostEl: HTMLElement) {
    this.hostEl = hostEl;
  }

  isOpen(): boolean {
    return this.rootEl !== null && !this.rootEl.hasClass('claudian-hidden');
  }

  setMessageRenderer(renderer: TranscriptMessageRenderer): void {
    this.renderer = renderer;
  }

  /** Register a handler invoked when the user leaves the transcript view. */
  setBackHandler(handler: () => void): void {
    this.backHandler = handler;
  }

  open(options: SubagentTranscriptPanelOptions = {}): void {
    if (options.status) {
      this.status = options.status;
    }
    if (options.description) {
      this.applyDescription(options.description);
    }
    this.ensureDom();
    if (!this.rootEl) return;
    const wasOpen = this.isOpen();
    this.rootEl.removeClass('claudian-hidden');
    this.updateStatus();
    if (!wasOpen) {
      this.moveFocusIntoPanel();
    }
  }

  close(): void {
    if (!this.rootEl) return;
    const wasOpen = this.isOpen();
    this.rootEl.addClass('claudian-hidden');
    if (wasOpen) {
      this.restoreFocus();
    }
  }

  setStatus(status: SubagentTranscriptPanelOptions['status']): void {
    if (!status) return;
    this.status = status;
    this.updateStatus();
  }

  /** Render a read-only transcript into the panel body. */
  renderMessages(messages: ChatMessage[]): void {
    this.ensureDom();
    if (!this.messagesContainerEl) return;

    const signature = buildMessagesSignature(messages);
    if (signature === this.lastRenderedSignature) {
      return;
    }
    this.lastRenderedSignature = signature;

    const container = this.messagesContainerEl;
    const previousScrollHeight = container.scrollHeight;
    const previousScrollTop = container.scrollTop;
    const followsBottom =
      previousScrollHeight > 0
      && previousScrollHeight - previousScrollTop - container.clientHeight
        <= SCROLL_FOLLOW_THRESHOLD_PX;

    container.empty();

    if (!messages.length) {
      const emptyEl = container.createDiv({
        cls: 'claudian-subagent-transcript-empty',
      });
      emptyEl.setText(t('chat.subagentTranscript.empty'));
      return;
    }

    if (this.renderer) {
      this.renderer(container, messages);
    } else {
      // Minimal fallback so the panel remains informative without a renderer.
      for (const msg of messages) {
        const row = container.createDiv({
          cls: `claudian-message claudian-message-${msg.role} claudian-subagent-transcript-entry`,
        });
        const contentEl = row.createDiv({
          cls: 'claudian-message-content claudian-subagent-transcript-entry-content',
        });
        const textEl = contentEl.createDiv({ cls: 'claudian-subagent-transcript-entry-text' });
        textEl.setText(msg.content);
        for (const toolCall of msg.toolCalls ?? []) {
          const toolEl = contentEl.createDiv({ cls: 'claudian-subagent-transcript-tool' });
          toolEl.setText(`${toolCall.name} (${toolCall.status ?? 'unknown'})`);
        }
      }
    }

    this.restoreScrollPosition(container, {
      previousScrollHeight,
      previousScrollTop,
      followsBottom,
    });
  }

  /** Show a notice when no sidecar transcript is available for the subagent. */
  showUnavailable(): void {
    this.ensureDom();
    if (!this.messagesContainerEl) return;
    this.lastRenderedSignature = null;
    this.messagesContainerEl.empty();
    const unavailableEl = this.messagesContainerEl.createDiv({
      cls: 'claudian-subagent-transcript-unavailable',
    });
    unavailableEl.setText(t('chat.subagentTranscript.unavailable'));
  }

  destroy(): void {
    this.rootEl?.remove();
    this.rootEl = null;
    this.backBarEl = null;
    this.statusTextEl = null;
    this.statusEl = null;
    this.titleEl = null;
    this.messagesContainerEl = null;
    this.renderer = null;
    this.backHandler = null;
    this.previouslyFocusedEl = null;
  }

  private ensureDom(): void {
    if (this.rootEl) return;

    const rootEl = this.hostEl.createDiv({
      cls: 'claudian-subagent-transcript claudian-hidden',
    });
    rootEl.setAttribute('role', 'dialog');
    rootEl.setAttribute('aria-label', t('chat.subagentTranscript.title'));

    const backBar = rootEl.createDiv({ cls: 'claudian-subagent-transcript-backbar' });
    backBar.setAttribute('role', 'button');
    backBar.setAttribute('tabindex', '0');
    backBar.setAttribute('aria-label', t('chat.subagentTranscript.backAriaLabel'));

    const backIcon = backBar.createDiv({ cls: 'claudian-subagent-transcript-back' });
    backIcon.setAttribute('aria-hidden', 'true');
    setIcon(backIcon, 'arrow-left');

    const heading = backBar.createDiv({ cls: 'claudian-subagent-transcript-heading' });
    const titleEl = heading.createDiv({ cls: 'claudian-subagent-transcript-title' });
    titleEl.setText(t('chat.subagentTranscript.title'));
    const subtitleEl = heading.createDiv({ cls: 'claudian-subagent-transcript-subtitle' });
    subtitleEl.setText(t('chat.subagentTranscript.subtitle'));

    const statusWrapEl = backBar.createDiv({ cls: 'claudian-subagent-transcript-status-wrap' });
    const statusTextEl = statusWrapEl.createDiv({ cls: 'claudian-subagent-transcript-status' });
    const statusEl = statusWrapEl.createDiv({ cls: 'claudian-subagent-transcript-status-icon' });

    backBar.addEventListener('click', (event: Event) => {
      event.stopPropagation();
      this.close();
      this.backHandler?.();
    });
    backBar.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.close();
        this.backHandler?.();
      }
    });
    // Escape leaves the transcript view while focus stays inside the panel.
    rootEl.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        this.backHandler?.();
      }
    });

    const messagesContainerEl = rootEl.createDiv({
      cls: 'claudian-messages claudian-subagent-transcript-messages',
    });

    this.rootEl = rootEl;
    this.backBarEl = backBar;
    this.titleEl = titleEl;
    this.statusTextEl = statusTextEl;
    this.statusEl = statusEl;
    this.messagesContainerEl = messagesContainerEl;

    if (this.pendingDescription) {
      rootEl.setAttribute('aria-label', this.pendingDescription);
      titleEl.setText(this.pendingDescription);
      this.pendingDescription = null;
    }
    this.updateStatus();
  }

  private applyDescription(description: string): void {
    this.rootEl?.setAttribute('aria-label', description);
    if (this.titleEl) {
      this.titleEl.setText(description);
    } else {
      this.pendingDescription = description;
    }
  }

  private updateStatus(): void {
    if (!this.statusTextEl || !this.statusEl) return;
    this.statusTextEl.setText(t(STATUS_LABEL_KEYS[this.status]));
    this.statusTextEl.removeAttribute('aria-label');
    this.statusEl.empty();
    for (const candidate of ['running', 'completed', 'error', 'orphaned'] as const) {
      this.statusEl.removeClass(`status-${candidate}`);
    }
    this.statusEl.addClass(`status-${this.status}`);
    setIcon(this.statusEl, STATUS_ICONS[this.status]);
  }

  private moveFocusIntoPanel(): void {
    const activeEl = this.hostEl.ownerDocument?.activeElement as HTMLElement | null;
    if (activeEl && activeEl !== this.hostEl.ownerDocument?.body) {
      this.previouslyFocusedEl = activeEl;
    }
    this.backBarEl?.focus?.();
  }

  private restoreFocus(): void {
    const previous = this.previouslyFocusedEl;
    this.previouslyFocusedEl = null;
    if (previous && typeof previous.focus === 'function' && previous.isConnected !== false) {
      previous.focus();
    }
  }

  /**
   * Keeps the panel's viewport stable across refresh re-renders: users pinned
   * to the bottom follow new content, and scrolled-up readers stay on the
   * same messages instead of being yanked to the top or dragged downward by
   * content appended below them.
   */
  private restoreScrollPosition(
    container: HTMLElement,
    snapshot: {
      previousScrollHeight: number;
      previousScrollTop: number;
      followsBottom: boolean;
    },
  ): void {
    const { previousScrollHeight, previousScrollTop, followsBottom } = snapshot;
    if (previousScrollHeight <= 0 || container.scrollHeight <= 0) return;
    if (followsBottom) {
      container.scrollTop = container.scrollHeight;
      return;
    }
    // Transcripts only ever grow at the bottom, so a scrolled-up reader's
    // messages keep their absolute offset; restoring the raw scrollTop keeps
    // them in place. Clamping keeps the value valid if the content shrank.
    container.scrollTop = Math.min(
      Math.max(0, previousScrollTop),
      container.scrollHeight,
    );
  }
}

/**
 * A cheap but stable fingerprint of everything {@link renderMessages} renders.
 * Polls that return byte-identical transcripts skip rebuilding the DOM, which
 * avoids scroll resets, focus loss, and re-running the markdown pipeline.
 */
function buildMessagesSignature(messages: ChatMessage[]): string {
  return messages.map((message) => JSON.stringify({
    id: message.id,
    role: message.role,
    content: message.content,
    contentBlocks: (message.contentBlocks ?? []).map((block) => {
      const summary: Record<string, unknown> = { type: block.type };
      if (block.type === 'tool_use') {
        summary.toolId = block.toolId;
      } else if (block.type === 'subagent') {
        summary.subagentId = block.subagentId;
        summary.mode = block.mode;
      } else if ('content' in block) {
        summary.content = block.content;
      } else if (block.type === 'citations') {
        summary.entryCount = block.citations.entries.length;
      }
      return summary;
    }),
    toolCalls: (message.toolCalls ?? []).map((toolCall: ToolCallInfo) => ({
      id: toolCall.id,
      name: toolCall.name,
      status: toolCall.status,
      result: toolCall.result,
      input: toolCall.input,
    })),
    images: message.images?.length ?? 0,
    isInterrupt: message.isInterrupt ?? false,
  })).join('\n');
}
