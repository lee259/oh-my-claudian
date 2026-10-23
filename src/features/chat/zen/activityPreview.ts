import type { ChatState } from '@/features/chat/state/ChatState';
import { t } from '@/i18n/i18n';

import type { ZenPreview } from './ZenModeController';

/** Bounded text projection, independent of whether the transcript is visible. */
export function getZenActivityPreview(state: ChatState | null | undefined): ZenPreview {
  const working = state?.isStreaming ?? false;
  const requiresAction = state?.requiresAction ?? false;
  if (requiresAction) return { text: t('chat.zen.actionRequired'), working, requiresAction };
  const message = state?.messages.at(-1);
  const runningTool = message?.toolCalls?.slice().reverse().find(tool => tool.status === 'running');
  let text: string;
  if (working && runningTool) text = t('chat.zen.toolRunning', { tool: runningTool.name });
  else if (working && state?.response.thinking && !state.response.text) text = t('chat.zen.thinking');
  else {
    const finalText = message?.contentBlocks?.slice().reverse().find(block => block.type === 'text');
    text = state?.response.text || (finalText?.type === 'text' ? finalText.content : message?.content) || t('chat.home.title');
  }
  const prefix = text.slice(0, 1000).replace(/\s+/g, ' ').trim();
  // Array.from keeps a trailing supplementary-plane character intact.
  const characters = Array.from(prefix);
  return { text: characters.length > 240 ? `${characters.slice(0, 239).join('')}…` : prefix, working, requiresAction };
}
