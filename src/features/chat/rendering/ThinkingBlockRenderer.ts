import { t } from '../../../i18n/i18n';
import { collapseElement, setupCollapsible } from './collapsible';

export type RenderContentFn = (el: HTMLElement, markdown: string) => Promise<void>;

export interface ThinkingBlockState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  labelEl: HTMLElement;
  content: string;
  startTime: number;
  timerInterval: number | null;
  isExpanded: boolean;
}

export interface ThinkingBlockOptions {
  onToggle?: (isExpanded: boolean) => void;
}

function summarizeThinking(content: string): string {
  const body = content.replace(/```[\s\S]*?(?:```|$)/g, ' ');
  const paragraph = body.split(/\n\s*\n/).map((part) => part.trim()).find(Boolean) ?? '';
  return paragraph
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createThinkingBlock(
  parentEl: HTMLElement,
  options: ThinkingBlockOptions = {},
): ThinkingBlockState {
  const wrapperEl = parentEl.createDiv({ cls: 'claudian-thinking-block' });

  // Header (clickable to expand/collapse)
  const header = wrapperEl.createDiv({ cls: 'claudian-thinking-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');
  header.setAttribute('aria-expanded', 'false');
  header.setAttribute('aria-label', t('chat.rendering.thinkingAria'));

  // Keep the live indicator compact while reasoning stays collapsed.
  const labelEl = header.createSpan({ cls: 'claudian-thinking-label' });
  const startTime = Date.now();
  labelEl.setText(t('chat.rendering.thinking', { seconds: 0 }));

  // Collapsible content (collapsed by default)
  const contentEl = wrapperEl.createDiv({ cls: 'claudian-thinking-content' });

  // Create state object first so toggle can reference it
  const state: ThinkingBlockState = {
    wrapperEl,
    contentEl,
    labelEl,
    content: '',
    startTime,
    timerInterval: null,
    isExpanded: false,
  };

  state.timerInterval = window.setInterval(() => {
    const summary = summarizeThinking(state.content);
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    labelEl.setText(summary || t('chat.rendering.thinking', { seconds: elapsed }));
  }, 1000);

  setupCollapsible(wrapperEl, header, contentEl, state, {
    onToggle: options.onToggle,
  });

  return state;
}

export async function appendThinkingContent(
  state: ThinkingBlockState,
  content: string,
  renderContent: RenderContentFn
) {
  state.content += content;
  const summary = summarizeThinking(state.content);
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  state.labelEl.setText(summary || t('chat.rendering.thinking', { seconds: elapsed }));
  await renderContent(state.contentEl, state.content);
}

export function finalizeThinkingBlock(state: ThinkingBlockState): number {
  // Stop the timer
  if (state.timerInterval) {
    window.clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  // Calculate final duration
  const durationSeconds = Math.floor((Date.now() - state.startTime) / 1000);

  state.labelEl.setText(summarizeThinking(state.content) || t('chat.rendering.thinkingSummary'));

  // Collapse when done and sync state
  const header = state.wrapperEl.querySelector('.claudian-thinking-header');
  if (header) {
    collapseElement(state.wrapperEl, header as HTMLElement, state.contentEl, state);
  }

  return durationSeconds;
}

export function cleanupThinkingBlock(state: ThinkingBlockState | null) {
  if (state?.timerInterval) {
    window.clearInterval(state.timerInterval);
  }
}

export function renderStoredThinkingBlock(
  parentEl: HTMLElement,
  content: string,
  _durationSeconds: number | undefined,
  renderContent: RenderContentFn
): HTMLElement {
  const wrapperEl = parentEl.createDiv({ cls: 'claudian-thinking-block' });

  // Header (clickable to expand/collapse)
  const header = wrapperEl.createDiv({ cls: 'claudian-thinking-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');
  header.setAttribute('aria-label', t('chat.rendering.thinkingAria'));

  // Keep completed reasoning collapsed behind a compact label.
  const labelEl = header.createSpan({ cls: 'claudian-thinking-label' });
  labelEl.setText(summarizeThinking(content) || t('chat.rendering.thinkingSummary'));

  // Collapsible content
  const contentEl = wrapperEl.createDiv({ cls: 'claudian-thinking-content', text: content });
  let rendered = false;
  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, header, contentEl, state, {
    onToggle: expanded => {
      if (!expanded || rendered) return;
      rendered = true;
      void renderContent(contentEl, content).catch(() => { contentEl.setText(content); });
    },
  });

  return wrapperEl;
}
