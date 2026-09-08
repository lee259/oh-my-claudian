import { setIcon } from 'obsidian';

import type { ChatMessage, ToolCallInfo } from '../../../core/types';

/**
 * Read-only display shape for a single transcript entry. Kept intentionally
 * small so the panel can render transcripts without owning a full message
 * renderer; richer rendering is delegated through {@link TranscriptMessageRenderer}.
 */
export interface TranscriptEntryView {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolCallInfo[];
}

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

const STATUS_LABELS: Record<NonNullable<SubagentTranscriptPanelOptions['status']>, string> = {
  running: 'Running in background',
  completed: 'Completed',
  error: 'Error',
  orphaned: 'Orphaned',
};

const STATUS_ICONS: Record<NonNullable<SubagentTranscriptPanelOptions['status']>, string> = {
  running: 'loader-2',
  completed: 'check',
  error: 'x',
  orphaned: 'alert-circle',
};

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
  private messagesContainerEl: HTMLElement | null = null;
  private renderer: TranscriptMessageRenderer | null = null;
  private backHandler: (() => void) | null = null;
  private status: NonNullable<SubagentTranscriptPanelOptions['status']> = 'running';

  constructor(hostEl: HTMLElement) {
    this.hostEl = hostEl;
  }

  isOpen(): boolean {
    return this.rootEl !== null && !this.rootEl.hasClass('claudian-hidden');
  }

  setMessageRenderer(renderer: TranscriptMessageRenderer): void {
    this.renderer = renderer;
  }

  /** Register a handler invoked when the user clicks the back-to-conversation bar. */
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
    this.rootEl.removeClass('claudian-hidden');
    this.updateStatus();
  }

  close(): void {
    if (!this.rootEl) return;
    this.rootEl.addClass('claudian-hidden');
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

    this.messagesContainerEl.empty();

    if (!messages.length) {
      const emptyEl = this.messagesContainerEl.createDiv({
        cls: 'claudian-subagent-transcript-empty',
      });
      emptyEl.setText('No conversation recorded for this subagent.');
      return;
    }

    if (this.renderer) {
      this.renderer(this.messagesContainerEl, messages);
      return;
    }

    // Minimal fallback so the panel remains informative without a renderer.
    for (const msg of messages) {
      const row = this.messagesContainerEl.createDiv({
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

  /** Show a notice when no sidecar transcript is available for the subagent. */
  showUnavailable(): void {
    this.ensureDom();
    if (!this.messagesContainerEl) return;
    this.messagesContainerEl.empty();
    const unavailableEl = this.messagesContainerEl.createDiv({
      cls: 'claudian-subagent-transcript-unavailable',
    });
    unavailableEl.setText('Full conversation not available for this subagent.');
  }

  destroy(): void {
    this.rootEl?.remove();
    this.rootEl = null;
    this.statusTextEl = null;
    this.statusEl = null;
    this.titleEl = null;
    this.messagesContainerEl = null;
    this.renderer = null;
    this.backHandler = null;
  }

  private ensureDom(): void {
    if (this.rootEl) return;

    const rootEl = this.hostEl.createDiv({
      cls: 'claudian-subagent-transcript claudian-hidden',
    });

    const backBar = rootEl.createDiv({ cls: 'claudian-subagent-transcript-backbar' });
    backBar.setAttribute('role', 'button');
    backBar.setAttribute('tabindex', '0');
    backBar.setAttribute('aria-label', 'Back to conversation');

    const backIcon = backBar.createDiv({ cls: 'claudian-subagent-transcript-back' });
    backIcon.setAttribute('aria-hidden', 'true');
    setIcon(backIcon, 'arrow-left');

    const heading = backBar.createDiv({ cls: 'claudian-subagent-transcript-heading' });
    const titleEl = heading.createDiv({ cls: 'claudian-subagent-transcript-title' });
    titleEl.setText('Subagent conversation');
    const subtitleEl = heading.createDiv({ cls: 'claudian-subagent-transcript-subtitle' });
    subtitleEl.setText('Read-only transcript');

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

    const messagesContainerEl = rootEl.createDiv({
      cls: 'claudian-messages claudian-subagent-transcript-messages',
    });

    this.rootEl = rootEl;
    this.titleEl = titleEl;
    this.statusTextEl = statusTextEl;
    this.statusEl = statusEl;
    this.messagesContainerEl = messagesContainerEl;

    if (this.pendingDescription) {
      titleEl.setText(this.pendingDescription);
      this.pendingDescription = null;
    }
    this.updateStatus();
  }

  private pendingDescription: string | null = null;

  private applyDescription(description: string): void {
    if (this.titleEl) {
      this.titleEl.setText(description);
    } else {
      this.pendingDescription = description;
    }
  }

  private updateStatus(): void {
    if (!this.statusTextEl || !this.statusEl) return;
    this.statusTextEl.setText(STATUS_LABELS[this.status]);
    this.statusTextEl.setAttribute('aria-label', `Status: ${this.status}`);
    this.statusEl.empty();
    setIcon(this.statusEl, STATUS_ICONS[this.status]);
  }
}
