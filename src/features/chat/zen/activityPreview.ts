import type { ChatState } from '@/features/chat/state/ChatState';
import { t } from '@/i18n/i18n';

import type { ZenPreview } from './ZenModeController';

/** Bounded text projection, independent of whether the transcript is visible. */
export function getZenActivityPreview(state: ChatState | null | undefined, title: string): ZenPreview {
  const working = state?.isStreaming ?? false;
  const requiresAction = state?.phase === 'needs-you';
  const hasMessages = (state?.messages.length ?? 0) > 0;
  const startedAt = working ? state?.responseStartTime : null;
  const status = { title, startedAt, hasMessages, working, requiresAction };
  if (requiresAction) return { ...status, text: t('chat.zen.actionRequired') };
  const message = state?.messages.at(-1);
  const runningTool = message?.toolCalls?.slice().reverse().find(tool => tool.status === 'running');
  let text: string;
  if (working && runningTool) text = t('chat.zen.toolRunning', { tool: runningTool.name });
  else if (working && state?.response.thinking && !state.response.text) text = t('chat.zen.thinking');
  else {
    const finalText = message?.contentBlocks?.slice().reverse().find(block => block.type === 'text');
    text = state?.response.text || (finalText?.type === 'text' ? finalText.content : message?.content) || t('chat.home.title');
  }
  const before = text.charCodeAt(999);
  const after = text.charCodeAt(1000);
  const scanEnd = before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF ? 999 : 1000;
  const prefix = text.slice(0, scanEnd).replace(/\s+/g, ' ').trim();
  // Array.from keeps a trailing supplementary-plane character intact.
  const characters = Array.from(prefix);
  return { ...status, text: characters.length > 240 ? `${characters.slice(0, 239).join('')}…` : prefix };
}
