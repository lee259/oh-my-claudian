import { t } from '../../../i18n/i18n';
import { collapseElement, setupCollapsible } from './collapsible';

export type RenderContentFn = (el: HTMLElement, markdown: string) => Promise<void>;

const preparationQueues = new WeakMap<Window, { pending: Array<() => void>; scheduled: boolean }>();
// Bound each burst of background work when opening a long transcript.
const MAX_PENDING_PREPARATIONS = 4;

function scheduleThinkingPreparation(view: Window, prepare: () => void): void {
  let queue = preparationQueues.get(view);
  if (!queue) {
    queue = { pending: [], scheduled: false };
    preparationQueues.set(view, queue);
  }
  queue.pending.push(prepare);
  if (queue.pending.length > MAX_PENDING_PREPARATIONS) queue.pending.shift();
  if (queue.scheduled) return;
  queue.scheduled = true;
  const currentQueue = queue;
  const schedule = () => {
    const run = () => {
      const next = currentQueue.pending.shift();
      if (!view.document.hidden) next?.();
      if (currentQueue.pending.length) view.setTimeout(schedule, 50);
      else currentQueue.scheduled = false;
    };
    if (typeof view.requestIdleCallback === 'function') view.requestIdleCallback(run);
    else view.setTimeout(run, 50);
  };
  schedule();
}

export interface ThinkingBlockState {
  presentation?: 'status';
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  labelEl: HTMLElement;
  content: string;
  startTime: number;
  timerInterval: number | null;
  isExpanded: boolean;
}

export interface ThinkingBlockOptions {
  startTime?: number;
  presentation?: 'expandable' | 'status';
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
  if (options.presentation === 'status') {
    const wrapperEl = parentEl.createDiv({ cls: 'claudian-reasoning-status', attr: { role: 'status' } });
    const labelEl = wrapperEl.createSpan({ cls: 'claudian-thinking-label' });
    labelEl.setText(t('chat.rendering.thinking', { seconds: 0 }));
    const contentEl = wrapperEl.createDiv();
    contentEl.hidden = true;
    return { wrapperEl, labelEl, contentEl, content: '', startTime: options.startTime ?? Date.now(),
      timerInterval: null, isExpanded: false, presentation: 'status' };
  }
  const wrapperEl = parentEl.createDiv({ cls: 'claudian-thinking-block' });

  // Header (clickable to expand/collapse)
  const header = wrapperEl.createDiv({ cls: 'claudian-thinking-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');
  header.setAttribute('aria-expanded', 'false');
  header.setAttribute('aria-label', t('chat.rendering.thinkingAria'));

  // Keep the live indicator compact while reasoning stays collapsed.
  const labelEl = header.createSpan({ cls: 'claudian-thinking-label' });
  const startTime = options.startTime ?? Date.now();
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

/** Update the live label without rendering or exposing reasoning content. */
export function refreshThinkingLabel(state: ThinkingBlockState): void {
  const content = state.presentation === 'status'
    ? state.content.split(/\n\s*\n/).filter(part => part.trim()).at(-1) ?? ''
    : state.content;
  const summary = summarizeThinking(content);
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  state.labelEl.setText(summary || t('chat.rendering.thinking', { seconds: elapsed }));
}

export async function appendThinkingContent(
  state: ThinkingBlockState,
  content: string,
  renderContent: RenderContentFn
) {
  state.content += content;
  refreshThinkingLabel(state);
  if (state.presentation === 'status') return;
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
  if (state.presentation === 'status') {
    state.wrapperEl.remove();
    return durationSeconds;
  }

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
  const prepare = () => {
    if (rendered) return;
    rendered = true;
    void renderContent(contentEl, content).catch(() => { contentEl.setText(content); });
  };
  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, header, contentEl, state, {
    animate: content.length < 4000,
    onToggle: expanded => {
      if (expanded) prepare();
    },
  });

  const view = wrapperEl.ownerDocument?.defaultView;
  if (view) scheduleThinkingPreparation(view, () => {
    if (wrapperEl.isConnected) prepare();
  });

  return wrapperEl;
}
