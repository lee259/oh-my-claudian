import { setIcon } from 'obsidian';

import { getToolIcon } from '../../../core/tools/toolIcons';
import type { ToolCallInfo, ToolDiffData } from '../../../core/types';
import type { DiffLine } from '../../../core/types/diff';
import { t } from '../../../i18n/i18n';
import { type FileReference,parseFileReference } from '../../../utils/FileReference';
import { setupCollapsible } from './collapsible';
import { renderDiffContent, renderDiffStats } from './DiffRenderer';
import { fileNameOnly, getToolName, getToolSummary, makeFileSummaryInteractive as makeToolFileSummaryInteractive } from './ToolCallRenderer';
import { attachToolDuration } from './ToolDuration';

export interface WriteEditState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statsEl: HTMLElement;
  statusEl: HTMLElement;
  toolCall: ToolCallInfo;
  isExpanded: boolean;
  diffLines?: DiffLine[];
  refreshHeader: () => void;
}

export interface WriteEditRenderOptions {
  initiallyExpanded?: boolean;
  onOpenFile?: (fileReference: FileReference) => void;
}

function makeFileSummaryInteractive(
  summaryEl: HTMLElement,
  filePath: string,
  onOpenFile: ((fileReference: FileReference) => void) | undefined,
): void {
  const reference = filePath && filePath !== 'file' ? parseFileReference(filePath) : undefined;
  makeToolFileSummaryInteractive(summaryEl, reference, onOpenFile);
}

function shortenPath(filePath: string, maxLength = 40): string {
  if (!filePath) return 'file';
  // Normalize path separators for cross-platform support
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.length <= maxLength) return normalized;

  const parts = normalized.split('/');
  if (parts.length <= 2) {
    return '...' + normalized.slice(-maxLength + 3);
  }

  // Show first dir + ... + filename
  const filename = parts[parts.length - 1];
  const firstDir = parts[0];
  const available = maxLength - firstDir.length - filename.length - 5; // 5 for ".../.../"

  if (available < 0) {
    return '...' + filename.slice(-maxLength + 3);
  }

  return `${firstDir}/.../${filename}`;
}

export function createWriteEditBlock(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo,
  options: WriteEditRenderOptions = {}
): WriteEditState {
  const filePath = (toolCall.input.file_path as string) || 'file';
  const toolName = toolCall.name; // 'Write' or 'Edit'

  const wrapperEl = parentEl.createDiv({ cls: 'claudian-write-edit-block' });
  wrapperEl.dataset.toolId = toolCall.id;

  // Header (clickable to collapse/expand)
  const headerEl = wrapperEl.createDiv({ cls: 'claudian-write-edit-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');

  // File icon
  const iconEl = headerEl.createDiv({ cls: 'claudian-write-edit-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, getToolIcon(toolName));

  const nameEl = headerEl.createDiv({ cls: 'claudian-write-edit-name' });
  nameEl.setText(toolName);
  const summaryEl = headerEl.createDiv({ cls: 'claudian-write-edit-summary' });
  summaryEl.setText(fileNameOnly(filePath) || 'file');
  makeFileSummaryInteractive(summaryEl, filePath, options.onOpenFile);

  // Populated when diff is computed
  const statsEl = headerEl.createDiv({ cls: 'claudian-write-edit-stats' });

  const refreshDuration = attachToolDuration(headerEl, toolCall);
  const statusEl = headerEl.createDiv({ cls: 'claudian-write-edit-status status-running' });
  statusEl.setAttribute('aria-label', t('chat.bangBash.statusLabel', { status: t('chat.toolStatus.running') }));

  // Content area (collapsed by default)
  const contentEl = wrapperEl.createDiv({ cls: 'claudian-write-edit-content' });

  // Initial loading state
  const loadingRow = contentEl.createDiv({ cls: 'claudian-write-edit-diff-row' });
  const loadingEl = loadingRow.createDiv({ cls: 'claudian-write-edit-loading' });
  loadingEl.setText(t('chat.rendering.writing'));

  // Create state object
  const state: WriteEditState = {
    wrapperEl,
    contentEl,
    headerEl,
    nameEl,
    summaryEl,
    statsEl,
    statusEl,
    toolCall,
    isExpanded: false,
    refreshHeader: () => {
      const tool = state.toolCall;
      refreshDuration(tool);
      const currentPath = (tool.input.file_path as string) || 'file';
      nameEl.setText(getToolName(tool.name, tool.input, tool.presentation));
      summaryEl.setText(getToolSummary(tool.name, tool.input, tool.presentation));
      makeFileSummaryInteractive(summaryEl, currentPath, options.onOpenFile);
      headerEl.setAttribute('aria-label', t(state.isExpanded ? 'chat.rendering.collapse' : 'chat.rendering.expand', { label: getAriaLabel() }));
    },
  };
  const getAriaLabel = () => `${state.toolCall.name}: ${shortenPath((state.toolCall.input.file_path as string) || 'file')}`;

  // Setup collapsible behavior (handles click, keyboard, ARIA, CSS)
  setupCollapsible(wrapperEl, headerEl, contentEl, state, {
    initiallyExpanded: options.initiallyExpanded ?? false,
    baseAriaLabel: getAriaLabel,
  });

  return state;
}

export function updateWriteEditWithDiff(state: WriteEditState, diffData: ToolDiffData): void {
  state.statsEl.empty();
  state.contentEl.empty();

  const { diffLines, stats } = diffData;
  state.diffLines = diffLines;

  // Update stats
  renderDiffStats(state.statsEl, stats);

  // Render diff content
  const row = state.contentEl.createDiv({ cls: 'claudian-write-edit-diff-row' });
  const diffEl = row.createDiv({ cls: 'claudian-write-edit-diff' });
  renderDiffContent(diffEl, diffLines);
}

export function finalizeWriteEditBlock(state: WriteEditState, isError: boolean): void {
  state.refreshHeader();
  // Update status icon - only show icon on error
  state.statusEl.className = 'claudian-write-edit-status';
  state.statusEl.empty();

  if (isError) {
    state.statusEl.addClass('status-error');
    setIcon(state.statusEl, 'x');
    state.statusEl.setAttribute('aria-label', t('chat.bangBash.statusLabel', { status: t('chat.toolStatus.error') }));

    // Show error in content if no diff was shown
    if (!state.diffLines) {
      state.contentEl.empty();
      const row = state.contentEl.createDiv({ cls: 'claudian-write-edit-diff-row' });
      const errorEl = row.createDiv({ cls: 'claudian-write-edit-error' });
      errorEl.setText(state.toolCall.result || t('common.error'));
    }
  } else if (!state.diffLines) {
    // Success but no diff data - clear the "Writing..." loading text and show DONE
    state.contentEl.empty();
    const row = state.contentEl.createDiv({ cls: 'claudian-write-edit-diff-row' });
    const doneEl = row.createDiv({ cls: 'claudian-write-edit-done-text' });
    doneEl.setText(t('chat.rendering.done'));
  }

  // Update wrapper class
  if (isError) {
    state.wrapperEl.addClass('error');
  } else {
    state.wrapperEl.addClass('done');
  }
}

export function renderStoredWriteEdit(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo,
  options: WriteEditRenderOptions = {}
): HTMLElement {
  const filePath = (toolCall.input.file_path as string) || 'file';
  const toolName = toolCall.name;
  const baseAriaLabel = `${toolName}: ${shortenPath(filePath)}`;
  const isError = toolCall.status === 'error' || toolCall.status === 'blocked';

  const wrapperEl = parentEl.createDiv({ cls: 'claudian-write-edit-block' });
  if (isError) {
    wrapperEl.addClass('error');
  } else if (toolCall.status === 'completed') {
    wrapperEl.addClass('done');
  }
  wrapperEl.dataset.toolId = toolCall.id;

  // Header
  const headerEl = wrapperEl.createDiv({ cls: 'claudian-write-edit-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');

  // File icon
  const iconEl = headerEl.createDiv({ cls: 'claudian-write-edit-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, getToolIcon(toolName));

  const nameEl = headerEl.createDiv({ cls: 'claudian-write-edit-name' });
  nameEl.setText(toolName);
  const summaryEl = headerEl.createDiv({ cls: 'claudian-write-edit-summary' });
  summaryEl.setText(fileNameOnly(filePath) || 'file');
  makeFileSummaryInteractive(summaryEl, filePath, options.onOpenFile);

  const statsEl = headerEl.createDiv({ cls: 'claudian-write-edit-stats' });
  if (toolCall.diffData) {
    renderDiffStats(statsEl, toolCall.diffData.stats);
  }

  // Status indicator - only show icon on error
  attachToolDuration(headerEl, toolCall);
  const statusEl = headerEl.createDiv({ cls: 'claudian-write-edit-status' });
  if (isError) {
    statusEl.addClass('status-error');
    setIcon(statusEl, 'x');
  }

  // Content
  const contentEl = wrapperEl.createDiv({ cls: 'claudian-write-edit-content' });

  let contentRendered = false;
  const renderContentOnce = () => {
    if (contentRendered) return;
    const row = contentEl.createDiv({ cls: 'claudian-write-edit-diff-row' });

    if (toolCall.diffData && toolCall.diffData.diffLines.length > 0) {
      const diffEl = row.createDiv({ cls: 'claudian-write-edit-diff' });
      renderDiffContent(diffEl, toolCall.diffData.diffLines);
    } else if (isError && toolCall.result) {
      const errorEl = row.createDiv({ cls: 'claudian-write-edit-error' });
      errorEl.setText(toolCall.result);
    } else {
      const doneEl = row.createDiv({ cls: 'claudian-write-edit-done-text' });
      doneEl.setText(isError ? t('chat.rendering.errorResult') : t('chat.rendering.done'));
    }
    contentRendered = true;
  };
  if (toolCall.status === 'running' || options.initiallyExpanded) renderContentOnce();

  // Setup collapsible behavior (handles click, keyboard, ARIA, CSS)
  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, headerEl, contentEl, state, {
    initiallyExpanded: options.initiallyExpanded ?? false,
    beforeToggle: (expanded) => {
      if (expanded) renderContentOnce();
    },
    baseAriaLabel,
  });

  return wrapperEl;
}
