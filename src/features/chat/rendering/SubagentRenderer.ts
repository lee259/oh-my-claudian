import { setIcon } from 'obsidian';

import { getToolIcon } from '../../../core/tools/toolIcons';
import { TOOL_SUBAGENT } from '../../../core/tools/toolNames';
import type { SubagentInfo, ToolCallInfo } from '../../../core/types';
import type { FileReference } from '../../../utils/FileReference';
import { setupCollapsible } from './collapsible';
import {
  getToolFilePath,
  getToolLabel,
  getToolName,
  getToolSummary,
  makeFileSummaryInteractive,
  renderExpandedContent,
  setToolIcon,
} from './ToolCallRenderer';

export interface SubagentRenderOptions {
  onOpenFile?: (fileReference: FileReference) => void;
}

interface SubagentToolView {
  wrapperEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  contentEl: HTMLElement;
}

interface SubagentSection {
  wrapperEl: HTMLElement;
  bodyEl: HTMLElement;
}

export interface SubagentState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  labelEl: HTMLElement;
  resultSummaryEl: HTMLElement;
  statusTextEl: HTMLElement;
  statusEl: HTMLElement;
  promptSectionEl: HTMLElement;
  promptBodyEl: HTMLElement;
  toolsContainerEl: HTMLElement;
  resultSectionEl: HTMLElement | null;
  resultBodyEl: HTMLElement | null;
  toolElements: Map<string, SubagentToolView>;
  info: SubagentInfo;
  onOpenFile?: (fileReference: FileReference) => void;
}

const SUBAGENT_TOOL_STATUS_ICONS: Partial<Record<ToolCallInfo['status'], string>> = {
  completed: 'check',
  error: 'x',
  blocked: 'shield-off',
};

const RESULT_SUMMARY_MAX_LENGTH = 120;

function summarizeResult(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= RESULT_SUMMARY_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, RESULT_SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
}

function updateResultSummary(summaryEl: HTMLElement, result: string): void {
  const summary = summarizeResult(result);
  summaryEl.setText(summary);
  summaryEl.toggleClass('claudian-hidden', summary.length === 0);
  if (summary.length > 0) {
    summaryEl.setAttribute('title', summary);
  } else {
    summaryEl.removeAttribute('title');
  }
}

function extractTaskDescription(input: Record<string, unknown>): string {
  return (input.description as string) || 'Subagent task';
}

function extractTaskPrompt(input: Record<string, unknown>): string {
  return (input.prompt as string) || '';
}

function truncateDescription(description: string, maxLength = 40): string {
  if (description.length <= maxLength) return description;
  return description.substring(0, maxLength) + '...';
}

function createSection(parentEl: HTMLElement, title: string, bodyClass?: string): SubagentSection {
  const wrapperEl = parentEl.createDiv({ cls: 'claudian-subagent-section' });

  const headerEl = wrapperEl.createDiv({ cls: 'claudian-subagent-section-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');

  const titleEl = headerEl.createDiv({ cls: 'claudian-subagent-section-title' });
  titleEl.setText(title);

  const bodyEl = wrapperEl.createDiv({ cls: 'claudian-subagent-section-body' });
  if (bodyClass) bodyEl.addClass(bodyClass);

  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, headerEl, bodyEl, state, {
    baseAriaLabel: title,
  });

  return { wrapperEl, bodyEl };
}

function setPromptText(promptBodyEl: HTMLElement, prompt: string): void {
  promptBodyEl.empty();
  const textEl = promptBodyEl.createDiv({ cls: 'claudian-subagent-prompt-text' });
  textEl.setText(prompt || 'No prompt provided');
}

function updateSyncHeaderAria(state: SubagentState): void {
  state.headerEl.setAttribute(
    'aria-label',
    `Subagent task: ${truncateDescription(state.info.description)} - Status: ${state.info.status} - click to expand`
  );
  state.statusEl.setAttribute('aria-label', `Status: ${state.info.status}`);
}

function renderSubagentToolContent(contentEl: HTMLElement, toolCall: ToolCallInfo): void {
  contentEl.empty();

  if (!toolCall.result && toolCall.status === 'running') {
    const emptyEl = contentEl.createDiv({ cls: 'claudian-subagent-tool-empty' });
    emptyEl.setText('Running...');
    return;
  }

  renderExpandedContent(contentEl, toolCall.name, toolCall.result, toolCall.input);
}

function setSubagentToolStatus(view: SubagentToolView, status: ToolCallInfo['status']): void {
  view.statusEl.className = 'claudian-subagent-tool-status';
  view.statusEl.addClass(`status-${status}`);
  view.statusEl.empty();
  view.statusEl.setAttribute('aria-label', `Status: ${status}`);

  const statusIcon = SUBAGENT_TOOL_STATUS_ICONS[status];
  if (statusIcon) {
    setIcon(view.statusEl, statusIcon);
  }
}

function updateSubagentToolView(view: SubagentToolView, toolCall: ToolCallInfo): void {
  view.wrapperEl.className = `claudian-subagent-tool-item claudian-subagent-tool-${toolCall.status}`;
  view.nameEl.setText(getToolName(toolCall.name, toolCall.input));
  view.summaryEl.setText(getToolSummary(toolCall.name, toolCall.input));
  setSubagentToolStatus(view, toolCall.status);
  renderSubagentToolContent(view.contentEl, toolCall);
}

function createSubagentToolView(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo,
  onOpenFile?: (fileReference: FileReference) => void,
): SubagentToolView {
  const wrapperEl = parentEl.createDiv({
    cls: `claudian-subagent-tool-item claudian-subagent-tool-${toolCall.status}`,
  });
  wrapperEl.dataset.toolId = toolCall.id;

  const headerEl = wrapperEl.createDiv({ cls: 'claudian-subagent-tool-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');

  const iconEl = headerEl.createDiv({ cls: 'claudian-subagent-tool-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setToolIcon(iconEl, toolCall.name);

  const nameEl = headerEl.createDiv({ cls: 'claudian-subagent-tool-name' });
  const summaryEl = headerEl.createDiv({ cls: 'claudian-subagent-tool-summary' });
  const statusEl = headerEl.createDiv({ cls: 'claudian-subagent-tool-status' });
  makeFileSummaryInteractive(summaryEl, getToolFilePath(toolCall), onOpenFile);

  const contentEl = wrapperEl.createDiv({ cls: 'claudian-subagent-tool-content' });

  const collapseState = { isExpanded: toolCall.isExpanded ?? false };
  setupCollapsible(wrapperEl, headerEl, contentEl, collapseState, {
    initiallyExpanded: toolCall.isExpanded ?? false,
    onToggle: (expanded) => {
      toolCall.isExpanded = expanded;
    },
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input),
  });

  const view: SubagentToolView = {
    wrapperEl,
    nameEl,
    summaryEl,
    statusEl,
    contentEl,
  };
  updateSubagentToolView(view, toolCall);

  return view;
}

function ensureResultSection(state: SubagentState): SubagentSection {
  if (state.resultSectionEl && state.resultBodyEl) {
    return { wrapperEl: state.resultSectionEl, bodyEl: state.resultBodyEl };
  }

  const section = createSection(state.contentEl, 'Result', 'claudian-subagent-result-body');
  section.wrapperEl.addClass('claudian-subagent-section-result');
  state.resultSectionEl = section.wrapperEl;
  state.resultBodyEl = section.bodyEl;
  return section;
}

function setResultText(state: SubagentState, text: string): void {
  const section = ensureResultSection(state);
  section.bodyEl.empty();
  const resultEl = section.bodyEl.createDiv({ cls: 'claudian-subagent-result-output' });
  resultEl.setText(text);
}

function hydrateSyncSubagentStateFromStored(state: SubagentState, subagent: SubagentInfo): void {
  state.info.description = subagent.description;
  state.info.prompt = subagent.prompt;
  state.info.mode = subagent.mode;
  state.info.status = subagent.status;
  state.info.result = subagent.result;

  state.labelEl.setText(truncateDescription(subagent.description));
  setPromptText(state.promptBodyEl, subagent.prompt || '');

  for (const originalToolCall of subagent.toolCalls) {
    const toolCall: ToolCallInfo = {
      ...originalToolCall,
      input: { ...originalToolCall.input },
    };
    addSubagentToolCall(state, toolCall);
    if (toolCall.status !== 'running' || toolCall.result) {
      updateSubagentToolResult(state, toolCall.id, toolCall);
    }
  }

  if (subagent.status === 'completed' || subagent.status === 'error') {
    const fallback = subagent.status === 'error' ? 'ERROR' : 'DONE';
    finalizeSubagentBlock(state, subagent.result || fallback, subagent.status === 'error');
  } else {
    state.statusEl.className = 'claudian-subagent-status status-running';
    state.statusEl.empty();
    updateSyncHeaderAria(state);
  }
}

export function createSubagentBlock(
  parentEl: HTMLElement,
  taskToolId: string,
  taskInput: Record<string, unknown>,
  options: SubagentRenderOptions = {},
): SubagentState {
  const description = extractTaskDescription(taskInput);
  const prompt = extractTaskPrompt(taskInput);

  const info: SubagentInfo = {
    id: taskToolId,
    description,
    prompt,
    status: 'running',
    toolCalls: [],
    isExpanded: false,
  };

  const wrapperEl = parentEl.createDiv({ cls: 'claudian-subagent-list' });
  wrapperEl.dataset.subagentId = taskToolId;

  const headerEl = wrapperEl.createDiv({ cls: 'claudian-subagent-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');

  const iconEl = headerEl.createDiv({ cls: 'claudian-subagent-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, getToolIcon(TOOL_SUBAGENT));

  const labelEl = headerEl.createDiv({ cls: 'claudian-subagent-label' });
  labelEl.setText(truncateDescription(description));

  const resultSummaryEl = headerEl.createDiv({
    cls: 'claudian-subagent-result-summary claudian-hidden',
  });

  const statusTextEl = headerEl.createDiv({ cls: 'claudian-subagent-status-text' });
  statusTextEl.setText('Running');

  const statusEl = headerEl.createDiv({ cls: 'claudian-subagent-status status-running' });
  statusEl.setAttribute('aria-label', 'Status: running');

  const contentEl = wrapperEl.createDiv({ cls: 'claudian-subagent-content' });

  const promptSection = createSection(contentEl, 'Prompt', 'claudian-subagent-prompt-body');
  promptSection.wrapperEl.addClass('claudian-subagent-section-prompt');
  setPromptText(promptSection.bodyEl, prompt);

  const toolsContainerEl = contentEl.createDiv({ cls: 'claudian-subagent-tools' });

  setupCollapsible(wrapperEl, headerEl, contentEl, info);

  const state: SubagentState = {
    wrapperEl,
    contentEl,
    headerEl,
    labelEl,
    resultSummaryEl,
    statusTextEl,
    statusEl,
    promptSectionEl: promptSection.wrapperEl,
    promptBodyEl: promptSection.bodyEl,
    toolsContainerEl,
    resultSectionEl: null,
    resultBodyEl: null,
    toolElements: new Map<string, SubagentToolView>(),
    onOpenFile: options.onOpenFile,
    info,
  };

  updateSyncHeaderAria(state);
  return state;
}

export function addSubagentToolCall(
  state: SubagentState,
  toolCall: ToolCallInfo
): void {
  const existingIndex = state.info.toolCalls.findIndex(tc => tc.id === toolCall.id);
  if (existingIndex >= 0) {
    const existingToolCall = state.info.toolCalls[existingIndex];
    const mergedToolCall: ToolCallInfo = {
      ...existingToolCall,
      ...toolCall,
      input: {
        ...existingToolCall.input,
        ...toolCall.input,
      },
      result: toolCall.result ?? existingToolCall.result,
      isExpanded: toolCall.isExpanded ?? existingToolCall.isExpanded,
    };

    state.info.toolCalls[existingIndex] = mergedToolCall;

    const existingView = state.toolElements.get(toolCall.id);
    if (existingView) {
      updateSubagentToolView(existingView, mergedToolCall);
    }

    updateSyncHeaderAria(state);
    return;
  }

  state.info.toolCalls.push(toolCall);

  const toolView = createSubagentToolView(state.toolsContainerEl, toolCall, state.onOpenFile);
  state.toolElements.set(toolCall.id, toolView);

  updateSyncHeaderAria(state);
}

export function updateSubagentToolResult(
  state: SubagentState,
  toolId: string,
  toolCall: ToolCallInfo
): void {
  const idx = state.info.toolCalls.findIndex(tc => tc.id === toolId);
  if (idx !== -1) {
    state.info.toolCalls[idx] = toolCall;
  }

  const toolView = state.toolElements.get(toolId);
  if (!toolView) {
    return;
  }

  updateSubagentToolView(toolView, toolCall);
}

export function finalizeSubagentBlock(
  state: SubagentState,
  result: string,
  isError: boolean
): void {
  state.info.status = isError ? 'error' : 'completed';
  state.info.result = result;

  state.labelEl.setText(truncateDescription(state.info.description));

  state.statusEl.className = 'claudian-subagent-status';
  state.statusEl.addClass(`status-${state.info.status}`);
  state.statusEl.empty();
  state.statusTextEl.setText(isError ? 'Error' : 'Completed');
  if (state.info.status === 'completed') {
    setIcon(state.statusEl, 'check');
    state.wrapperEl.removeClass('error');
    state.wrapperEl.addClass('done');
  } else {
    setIcon(state.statusEl, 'x');
    state.wrapperEl.removeClass('done');
    state.wrapperEl.addClass('error');
  }

  const finalText = result?.trim() ? result : (isError ? 'ERROR' : 'DONE');
  setResultText(state, finalText);
  updateResultSummary(state.resultSummaryEl, finalText);

  updateSyncHeaderAria(state);
}

export function renderStoredSubagent(
  parentEl: HTMLElement,
  subagent: SubagentInfo,
  options: SubagentRenderOptions = {},
): HTMLElement {
  const state = createSubagentBlock(parentEl, subagent.id, {
    description: subagent.description,
    prompt: subagent.prompt,
  }, options);

  hydrateSyncSubagentStateFromStored(state, subagent);
  return state.wrapperEl;
}

export interface AsyncSubagentState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  labelEl: HTMLElement;
  resultSummaryEl: HTMLElement;
  statusTextEl: HTMLElement;  // Running / Completed / Error / Orphaned
  statusEl: HTMLElement;
  openTranscriptBtnEl?: HTMLElement | null;
  info: SubagentInfo;
  onOpenFile?: (fileReference: FileReference) => void;
}

/**
 * Bubbling DOM event dispatched from an async subagent card when the user asks
 * to open the subagent's full conversation. The event target is the card
 * wrapper; `detail` carries the task tool-use id and the runtime agent id.
 */
export const OPEN_SUBAGENT_TRANSCRIPT_EVENT = 'claudian:open-subagent-transcript';

export interface OpenSubagentTranscriptDetail {
  taskToolId: string;
  agentId?: string;
  description?: string;
  status?: 'running' | 'completed' | 'error' | 'orphaned';
}

/** Adds (or returns) an "open full conversation" button to an async card header. */
function ensureOpenTranscriptButton(state: AsyncSubagentState): HTMLElement | null {
  if (state.openTranscriptBtnEl) return state.openTranscriptBtnEl;
  const btnEl = createOpenTranscriptButton(state.headerEl, state.wrapperEl, state.info);
  state.openTranscriptBtnEl = btnEl;
  return btnEl;
}

function createOpenTranscriptButton(
  headerEl: HTMLElement,
  wrapperEl: HTMLElement,
  info: SubagentInfo,
): HTMLElement | null {
  if (!info.agentId) return null;

  const btnEl = headerEl.createDiv({ cls: 'claudian-subagent-open-transcript' });
  btnEl.setAttribute('aria-label', `Open full conversation of ${truncateDescription(info.description)}`);
  btnEl.setAttribute('role', 'button');
  btnEl.setAttribute('tabindex', '0');
  setIcon(btnEl, 'external-link');

  const dispatchOpen = () => {
    const status = (['running', 'completed', 'error', 'orphaned'] as const)
      .find(candidate => wrapperEl.hasClass(candidate));
    const detail: OpenSubagentTranscriptDetail = {
      taskToolId: info.id,
      agentId: info.agentId,
      description: info.description,
      status,
    };
    wrapperEl.dispatchEvent(new CustomEvent(OPEN_SUBAGENT_TRANSCRIPT_EVENT, {
      bubbles: true,
      detail,
    }));
  };

  btnEl.addEventListener('click', (event: Event) => {
    event.stopPropagation();
    event.preventDefault?.();
    dispatchOpen();
  });
  btnEl.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault?.();
      event.stopPropagation();
      dispatchOpen();
    }
  });

  return btnEl;
}

function setAsyncWrapperStatus(wrapperEl: HTMLElement, status: string): void {
  const classes = ['pending', 'running', 'awaiting', 'completed', 'error', 'orphaned', 'async'];
  classes.forEach(cls => wrapperEl.removeClass(cls));
  wrapperEl.addClass('async');
  wrapperEl.addClass(status);
}

function setAsyncRunningIcon(statusEl: HTMLElement, ariaStatus: string): void {
  statusEl.className = 'claudian-subagent-status status-running';
  statusEl.empty();
  statusEl.setAttribute('aria-label', `Status: ${ariaStatus}`);
  setIcon(statusEl, 'loader-2');
}

function getAsyncDisplayStatus(asyncStatus: string | undefined): 'running' | 'completed' | 'error' | 'orphaned' {
  switch (asyncStatus) {
    case 'completed': return 'completed';
    case 'error': return 'error';
    case 'orphaned': return 'orphaned';
    default: return 'running';
  }
}

function getAsyncStatusText(asyncStatus: string | undefined): string {
  switch (asyncStatus) {
    case 'pending': return 'Initializing';
    case 'completed': return 'Completed';
    case 'error': return 'Error';
    case 'orphaned': return 'Orphaned';
    default: return 'Running in background';
  }
}

function getAsyncStatusAriaLabel(asyncStatus: string | undefined): string {
  switch (asyncStatus) {
    case 'pending': return 'Initializing';
    case 'completed': return 'Completed';
    case 'error': return 'Error';
    case 'orphaned': return 'Orphaned';
    default: return 'Running in background';
  }
}

function updateAsyncLabel(state: AsyncSubagentState): void {
  state.labelEl.setText(truncateDescription(state.info.description));

  const statusLabel = getAsyncStatusAriaLabel(state.info.asyncStatus);
  state.headerEl.setAttribute(
    'aria-label',
    `Background task: ${truncateDescription(state.info.description)} - ${statusLabel} - click to expand`
  );
}

interface AsyncContentSections {
  toolsContainerEl: HTMLElement;
  renderedToolIds: Set<string>;
  resultBodyEl: HTMLElement | null;
  resultOutputEl: HTMLElement | null;
  onOpenFile?: (fileReference: FileReference) => void;
}

/**
 * Per-content-element async card sections. Keyed by the async card's content
 * element so repeated status publishes reconcile in place instead of tearing
 * down and rebuilding the whole card (prompt + every tool view + result).
 */
const asyncContentSections = new WeakMap<HTMLElement, AsyncContentSections>();

function getOrCreateAsyncContentSections(
  contentEl: HTMLElement,
  subagent: SubagentInfo,
  onOpenFile?: (fileReference: FileReference) => void,
): AsyncContentSections {
  const existing = asyncContentSections.get(contentEl);
  if (existing) return existing;

  contentEl.empty();

  const promptSection = createSection(contentEl, 'Prompt', 'claudian-subagent-prompt-body');
  promptSection.wrapperEl.addClass('claudian-subagent-section-prompt');
  setPromptText(promptSection.bodyEl, subagent.prompt || '');

  const toolsContainerEl = contentEl.createDiv({ cls: 'claudian-subagent-tools' });
  const sections: AsyncContentSections = {
    toolsContainerEl,
    renderedToolIds: new Set(),
    resultBodyEl: null,
    resultOutputEl: null,
    onOpenFile,
  };
  asyncContentSections.set(contentEl, sections);
  return sections;
}

function appendMissingAsyncToolViews(sections: AsyncContentSections, subagent: SubagentInfo): void {
  for (const originalToolCall of subagent.toolCalls) {
    if (sections.renderedToolIds.has(originalToolCall.id)) continue;
    const toolCall: ToolCallInfo = {
      ...originalToolCall,
      input: { ...originalToolCall.input },
    };
    createSubagentToolView(sections.toolsContainerEl, toolCall, sections.onOpenFile);
    sections.renderedToolIds.add(originalToolCall.id);
  }
}

function ensureAsyncResultSection(contentEl: HTMLElement, sections: AsyncContentSections): HTMLElement {
  if (!sections.resultBodyEl) {
    const resultSection = createSection(contentEl, 'Result', 'claudian-subagent-result-body');
    resultSection.wrapperEl.addClass('claudian-subagent-section-result');
    sections.resultBodyEl = resultSection.bodyEl;
  }
  if (!sections.resultOutputEl) {
    sections.resultOutputEl = sections.resultBodyEl.createDiv({ cls: 'claudian-subagent-result-output' });
  }
  return sections.resultOutputEl;
}

function renderAsyncContentLikeSync(
  contentEl: HTMLElement,
  subagent: SubagentInfo,
  displayStatus: 'running' | 'completed' | 'error' | 'orphaned',
  onOpenFile?: (fileReference: FileReference) => void,
): void {
  const sections = getOrCreateAsyncContentSections(contentEl, subagent, onOpenFile);
  appendMissingAsyncToolViews(sections, subagent);

  if (displayStatus === 'running') {
    return;
  }

  const resultEl = ensureAsyncResultSection(contentEl, sections);

  if (displayStatus === 'orphaned') {
    resultEl.setText(subagent.result || 'Conversation ended before task completed');
    return;
  }

  const fallback = displayStatus === 'error' ? 'ERROR' : 'DONE';
  const finalText = subagent.result?.trim() ? subagent.result : fallback;
  resultEl.setText(finalText);
}

/**
 * Create an async subagent block for a background Agent tool call.
 * Expandable to show the task prompt. Collapsed by default.
 */
export function createAsyncSubagentBlock(
  parentEl: HTMLElement,
  taskToolId: string,
  taskInput: Record<string, unknown>,
  options: SubagentRenderOptions = {},
): AsyncSubagentState {
  const description = (taskInput.description as string) || 'Background task';
  const prompt = (taskInput.prompt as string) || '';

  const info: SubagentInfo = {
    id: taskToolId,
    description,
    prompt,
    mode: 'async',
    status: 'running',
    toolCalls: [],
    isExpanded: false,
    asyncStatus: 'pending',
  };

  const wrapperEl = parentEl.createDiv({ cls: 'claudian-subagent-list' });
  setAsyncWrapperStatus(wrapperEl, 'pending');
  wrapperEl.dataset.asyncSubagentId = taskToolId;

  const headerEl = wrapperEl.createDiv({ cls: 'claudian-subagent-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');
  headerEl.setAttribute('aria-expanded', 'false');
  headerEl.setAttribute('aria-label', `Background task: ${description} - Initializing - click to expand`);

  const iconEl = headerEl.createDiv({ cls: 'claudian-subagent-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, getToolIcon(TOOL_SUBAGENT));

  const labelEl = headerEl.createDiv({ cls: 'claudian-subagent-label' });
  labelEl.setText(truncateDescription(description));

  const resultSummaryEl = headerEl.createDiv({
    cls: 'claudian-subagent-result-summary claudian-hidden',
  });

  const statusTextEl = headerEl.createDiv({ cls: 'claudian-subagent-status-text' });
  statusTextEl.setText('Initializing');

  const statusEl = headerEl.createDiv({ cls: 'claudian-subagent-status status-running' });
  statusEl.setAttribute('aria-label', 'Status: running');
  setIcon(statusEl, 'loader-2');

  const contentEl = wrapperEl.createDiv({ cls: 'claudian-subagent-content' });
  renderAsyncContentLikeSync(contentEl, info, 'running', options.onOpenFile);

  setupCollapsible(wrapperEl, headerEl, contentEl, info);

  return {
    wrapperEl,
    contentEl,
    headerEl,
    labelEl,
    resultSummaryEl,
    statusTextEl,
    statusEl,
    info,
    onOpenFile: options.onOpenFile,
  };
}

export function updateAsyncSubagentRunning(
  state: AsyncSubagentState,
  agentId: string
): void {
  state.info.asyncStatus = 'running';
  state.info.agentId = agentId;

  setAsyncWrapperStatus(state.wrapperEl, 'running');
  updateAsyncLabel(state);

  state.statusTextEl.setText('Running in background');
  setAsyncRunningIcon(state.statusEl, 'running');

  ensureOpenTranscriptButton(state);

  renderAsyncContentLikeSync(state.contentEl, state.info, 'running', state.onOpenFile);
}

export function finalizeAsyncSubagent(
  state: AsyncSubagentState,
  result: string,
  isError: boolean
): void {
  state.info.asyncStatus = isError ? 'error' : 'completed';
  state.info.status = isError ? 'error' : 'completed';
  state.info.result = result;

  setAsyncWrapperStatus(state.wrapperEl, isError ? 'error' : 'completed');
  updateAsyncLabel(state);

  state.statusTextEl.setText(isError ? 'Error' : 'Completed');

  state.statusEl.className = 'claudian-subagent-status';
  state.statusEl.addClass(`status-${isError ? 'error' : 'completed'}`);
  state.statusEl.empty();
  if (isError) {
    setIcon(state.statusEl, 'x');
  } else {
    setIcon(state.statusEl, 'check');
  }

  if (isError) {
    state.wrapperEl.addClass('error');
  } else {
    state.wrapperEl.addClass('done');
  }

  updateResultSummary(state.resultSummaryEl, result?.trim() ? result : (isError ? 'ERROR' : 'DONE'));

  renderAsyncContentLikeSync(state.contentEl, state.info, isError ? 'error' : 'completed', state.onOpenFile);
}

export function markAsyncSubagentOrphaned(state: AsyncSubagentState): void {
  state.info.asyncStatus = 'orphaned';
  state.info.status = 'error';
  state.info.result = 'Conversation ended before task completed';

  setAsyncWrapperStatus(state.wrapperEl, 'orphaned');
  updateAsyncLabel(state);

  state.statusTextEl.setText('Orphaned');

  state.statusEl.className = 'claudian-subagent-status status-error';
  state.statusEl.empty();
  setIcon(state.statusEl, 'alert-circle');

  state.wrapperEl.addClass('error');
  state.wrapperEl.addClass('orphaned');

  updateResultSummary(state.resultSummaryEl, state.info.result);

  renderAsyncContentLikeSync(state.contentEl, state.info, 'orphaned', state.onOpenFile);
}

/**
 * Render a stored async subagent from conversation history.
 * Expandable to show the task prompt. Collapsed by default.
 */
export function renderStoredAsyncSubagent(
  parentEl: HTMLElement,
  subagent: SubagentInfo,
  options: SubagentRenderOptions = {},
): HTMLElement {
  const wrapperEl = parentEl.createDiv({ cls: 'claudian-subagent-list' });
  const displayStatus = getAsyncDisplayStatus(subagent.asyncStatus);
  setAsyncWrapperStatus(wrapperEl, displayStatus);

  if (displayStatus === 'completed') {
    wrapperEl.addClass('done');
  } else if (displayStatus === 'error' || displayStatus === 'orphaned') {
    wrapperEl.addClass('error');
  }
  wrapperEl.dataset.asyncSubagentId = subagent.id;

  const statusText = getAsyncStatusText(subagent.asyncStatus);
  const statusAriaLabel = getAsyncStatusAriaLabel(subagent.asyncStatus);

  const headerEl = wrapperEl.createDiv({ cls: 'claudian-subagent-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');
  headerEl.setAttribute('aria-expanded', 'false');
  headerEl.setAttribute(
    'aria-label',
    `Background task: ${subagent.description} - ${statusAriaLabel} - click to expand`
  );

  const iconEl = headerEl.createDiv({ cls: 'claudian-subagent-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, getToolIcon(TOOL_SUBAGENT));

  const labelEl = headerEl.createDiv({ cls: 'claudian-subagent-label' });
  labelEl.setText(truncateDescription(subagent.description));

  const statusTextEl = headerEl.createDiv({ cls: 'claudian-subagent-status-text' });
  statusTextEl.setText(statusText);

  let statusIconClass: string;
  switch (displayStatus) {
    case 'error':
    case 'orphaned':
      statusIconClass = 'status-error';
      break;
    case 'completed':
      statusIconClass = 'status-completed';
      break;
    default:
      statusIconClass = 'status-running';
  }
  const statusEl = headerEl.createDiv({ cls: `claudian-subagent-status ${statusIconClass}` });
  statusEl.setAttribute('aria-label', `Status: ${statusAriaLabel}`);

  switch (displayStatus) {
    case 'completed':
      setIcon(statusEl, 'check');
      break;
    case 'error':
      setIcon(statusEl, 'x');
      break;
    case 'orphaned':
      setIcon(statusEl, 'alert-circle');
      break;
    case 'running':
      setIcon(statusEl, 'loader-2');
      break;
  }

  const contentEl = wrapperEl.createDiv({ cls: 'claudian-subagent-content' });
  renderAsyncContentLikeSync(contentEl, subagent, displayStatus, options.onOpenFile);

  createOpenTranscriptButton(headerEl, wrapperEl, subagent);

  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, headerEl, contentEl, state);

  return wrapperEl;
}
