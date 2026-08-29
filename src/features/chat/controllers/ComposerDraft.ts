import type { QueuedMessage } from '../state/types';
import { createQueuedMessage } from './QueuedTurn';

export function captureComposerDraft(
  content: string,
  images: QueuedMessage['images'],
): QueuedMessage | null {
  if (!content.trim() && !images?.length) return null;
  return createQueuedMessage(content, { images, text: content });
}
