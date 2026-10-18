import type { QueuedMessage } from '../state/types';
import { createQueuedMessage } from './QueuedTurn';

/** Restores an unsent message ahead of the current draft without trimming user text. */
export function mergeComposerDraftContent(restored: string, current: string): string {
  if (!current.trim()) return restored;
  if (!restored.trim()) return current;
  const separator = restored.endsWith('\n\n') ? '' : restored.endsWith('\n') ? '\n' : '\n\n';
  return restored + separator + current;
}

export function captureComposerDraft(
  content: string,
  images: QueuedMessage['images'],
): QueuedMessage | null {
  if (!content.trim() && !images?.length) return null;
  return createQueuedMessage(content, { images, text: content });
}
