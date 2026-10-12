import { getTranscriptBlockId } from '@/core/transcript/TranscriptProjection';
import type { ChatMessage, ContentBlock } from '@/core/types';

export interface ResponseThinking {
  content: string;
  startTime: number;
}

/** Open response content survives absent presentation; DOM nodes are projections only. */
export class ResponseModel {
  messageId: string | null = null;
  text = '';
  thinking: ResponseThinking | null = null;

  appendThinking(content: string, startTime = Date.now()): ResponseThinking {
    const thinking = this.thinking ??= { content: '', startTime };
    thinking.content += content;
    return thinking;
  }

  takeText(): Extract<ContentBlock, { type: 'text' }> | null {
    const content = this.text;
    this.text = '';
    return content ? { type: 'text', content } : null;
  }

  takeThinking(now = Date.now()): Extract<ContentBlock, { type: 'thinking' }> | null {
    const thinking = this.thinking;
    this.thinking = null;
    return thinking?.content ? {
      type: 'thinking', content: thinking.content,
      durationSeconds: Math.max(0, Math.floor((now - thinking.startTime) / 1_000)),
    } : null;
  }

  appendBlock(message: ChatMessage, block: ContentBlock): ContentBlock {
    const blocks = message.contentBlocks ??= [];
    const identified = block.id ? block : { ...block, id: getTranscriptBlockId(message.id, block, blocks.length) };
    blocks.push(identified);
    return identified;
  }

  reset(): void {
    this.messageId = null;
    this.text = '';
    this.thinking = null;
  }
}
