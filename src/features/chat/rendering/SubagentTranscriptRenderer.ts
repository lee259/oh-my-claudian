import type { ChatMessage } from '../../../core/types';
import { renderStoredToolCall } from './ToolCallRenderer';

export interface SubagentTranscriptRendererOptions {
  /**
   * Renders one markdown text block into the given element. When omitted the
   * renderer falls back to plain text, keeping the panel usable standalone.
   */
  renderMarkdown?: (el: HTMLElement, markdown: string) => Promise<void> | void;
}

/**
 * Renders a read-only subagent transcript into `containerEl` using the shared
 * stored-message presentation where possible: text blocks go through the host's
 * markdown pipeline, thinking blocks stay muted and pre-wrapped, and tool calls
 * become the same collapsible stored tool cards used in the main conversation.
 *
 * This renderer is purely presentational for replay content - it never touches
 * message lifecycle, conversation persistence, or provider-session state.
 */
export function renderSubagentTranscriptMessages(
  containerEl: HTMLElement,
  messages: ChatMessage[],
  options: SubagentTranscriptRendererOptions = {},
): void {
  const { renderMarkdown } = options;

  for (const msg of messages) {
    const texts = collectRenderableTexts(msg);
    const toolCalls = msg.toolCalls ?? [];

    if (texts.length === 0 && toolCalls.length === 0) {
      continue;
    }

    const entry = containerEl.createDiv({
      cls: `claudian-message claudian-message-${msg.role} claudian-subagent-transcript-entry`,
    });
    const contentEl = entry.createDiv({
      cls: 'claudian-message-content claudian-subagent-transcript-entry-content',
    });

    for (const text of texts) {
      if (text.kind === 'thinking') {
        const thinkingEl = contentEl.createDiv({
          cls: 'claudian-subagent-transcript-thinking',
        });
        thinkingEl.setText(text.content);
        continue;
      }
      const textEl = contentEl.createDiv({
        cls: renderMarkdown
          ? 'claudian-subagent-transcript-markdown'
          : 'claudian-subagent-transcript-entry-text',
      });
      if (renderMarkdown) {
        const markdown = text.content;
        void Promise.resolve(renderMarkdown(textEl, markdown)).catch(() => {
          textEl.setText(markdown);
        });
      } else {
        textEl.setText(text.content);
      }
    }

    for (const toolCall of toolCalls) {
      renderStoredToolCall(contentEl, toolCall);
    }
  }
}

interface RenderableText {
  kind: 'text' | 'thinking';
  content: string;
}

function collectRenderableTexts(msg: ChatMessage): RenderableText[] {
  const contentBlocks = msg.contentBlocks ?? [];

  if (contentBlocks.length === 0) {
    return hasVisibleText(msg.content)
      ? [{ kind: 'text', content: msg.content }]
      : [];
  }

  const texts: RenderableText[] = [];
  for (const block of contentBlocks) {
    if (block.type === 'text' && hasVisibleText(block.content)) {
      texts.push({ kind: 'text', content: block.content });
    } else if (block.type === 'thinking' && hasVisibleText(block.content)) {
      texts.push({ kind: 'thinking', content: block.content });
    } else if (block.type === 'context_compacted') {
      texts.push({ kind: 'text', content: 'Conversation compacted' });
    }
    // tool_use / subagent / citations blocks carry no inline text of their own;
    // their tool content renders from msg.toolCalls below.
  }
  return texts;
}

function hasVisibleText(content: string | undefined): boolean {
  return !!content && content.trim().length > 0;
}
