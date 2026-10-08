import {
  isAgentLifecycleTool,
  isWriteEditTool,
  TOOL_APPLY_PATCH,
  TOOL_BASH,
  TOOL_BASH_OUTPUT,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_KILL_SHELL,
  TOOL_LS,
  TOOL_NOTEBOOK_EDIT,
  TOOL_READ,
  TOOL_SUBAGENT,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
import type {
  ProjectedTranscriptBlock,
  TranscriptRunProjection,
  TranscriptTurnProjection,
} from '../../../core/transcript/TranscriptProjection';
import type { ContentBlock } from '../../../core/types';

export type ActivityWorkKind = 'edit' | 'run' | 'agent' | 'research' | 'other' | 'think' | 'note';

export interface ActivityPhase {
  kind: ActivityWorkKind;
  stepIndexes: number[];
  active?: boolean;
  id?: string;
  turnId?: string;
  runId?: string;
  executionId?: string;
  executionTurnId?: string;
}

export type TranscriptTurnItem =
  | { type: 'block'; blockIndex: number; foldable: boolean; boundaryBefore: boolean }
  | {
    type: 'activity';
    phases: ActivityPhase[];
    boundaryBefore: boolean;
  }
  | { type: 'subagents'; blockIndexes: number[]; boundaryBefore: boolean };

export interface ActivityTimelineOptions {
  pendingToolIds?: ReadonlySet<string>;
  backgroundToolIds?: ReadonlySet<string>;
  failedSubagentIds?: ReadonlySet<string>;
  boundaryBeforeIndexes?: ReadonlySet<number>;
  toolNames?: ReadonlyMap<string, string>;
  live?: boolean;
  suppressInitialThinking?: boolean;
}

export interface ActivityTimeline {
  items: TranscriptTurnItem[];
  fold?: { start: number; end: number };
}

/** Builds ordered transcript items and the answered work range for one turn. */
export function buildActivityTimeline(
  projection: TranscriptRunProjection | TranscriptTurnProjection,
  options: ActivityTimelineOptions = {},
): ActivityTimeline {
  const projectedBlocks = projection.blocks;
  const blocks = projectedBlocks.map((projectedBlock) => projectedBlock.block);
  const pendingToolIds = options.pendingToolIds ?? new Set<string>();
  const failedSubagentIds = options.failedSubagentIds ?? new Set<string>();
  const boundaryBeforeIndexes = options.boundaryBeforeIndexes ?? new Set<number>();
  const supersededInitialThinking = options.suppressInitialThinking === false
    ? new Set<number>()
    : getSupersededInitialThinkingIndexes(blocks);
  const items: TranscriptTurnItem[] = [];
  let activityIndexes: number[] = [];
  let boundaryBeforeNext = false;

  const flushActivity = () => {
    if (activityIndexes.length === 0) return;
    items.push({
      type: 'activity',
      phases: buildActivityPhases(blocks, projectedBlocks, activityIndexes, options),
      boundaryBefore: boundaryBeforeNext,
    });
    activityIndexes = [];
    boundaryBeforeNext = false;
  };

  for (let index = 0; index < blocks.length; index += 1) {
    if (supersededInitialThinking.has(index)) continue;
    if (boundaryBeforeIndexes.has(index)) {
      flushActivity();
      boundaryBeforeNext = true;
    }

    const block = blocks[index];
    if (isFailedSubagent(block, failedSubagentIds)) {
      flushActivity();
      const previous = items.at(-1);
      if (previous?.type === 'subagents' && !boundaryBeforeNext) {
        previous.blockIndexes.push(index);
      } else {
        items.push({ type: 'subagents', blockIndexes: [index], boundaryBefore: boundaryBeforeNext });
      }
      boundaryBeforeNext = false;
    } else if (isActivityBlock(block, pendingToolIds)) {
      activityIndexes.push(index);
    } else {
      flushActivity();
      items.push({
        type: 'block',
        blockIndex: index,
        foldable: block.type === 'text' && !!block.content.trim(),
        boundaryBefore: boundaryBeforeNext,
      });
      boundaryBeforeNext = false;
    }
  }
  flushActivity();

  if (options.live) {
    for (const item of items) {
      if (item.type === 'activity') {
        for (const phase of item.phases) phase.active = false;
      }
    }
    const currentItem = items.at(-1);
    if (currentItem?.type === 'activity') {
      for (const phase of currentItem.phases) phase.active = true;
    }
  }

  const fold = findAnsweredWorkFold(items, blocks, options.backgroundToolIds ?? new Set<string>());
  return {
    items,
    fold: options.live && fold ? extendLiveWorkFold(items, fold) : fold,
  };
}

function buildActivityPhases(
  blocks: ContentBlock[],
  projectedBlocks: ProjectedTranscriptBlock[],
  stepIndexes: number[],
  options: ActivityTimelineOptions,
): ActivityPhase[] {
  if (stepIndexes.length === 0) return [];
  const firstIndex = stepIndexes[0];
  const firstBlock = projectedBlocks[firstIndex];
  const id = firstBlock?.id;
  return [{
    kind: getPhaseKind(blocks, stepIndexes, options.toolNames),
    stepIndexes,
    ...(id ? { id } : {}),
    turnId: firstBlock?.turnId,
    runId: firstBlock?.runId,
    ...(firstBlock?.executionId ? { executionId: firstBlock.executionId } : {}),
    ...(firstBlock?.executionTurnId ? { executionTurnId: firstBlock.executionTurnId } : {}),
  }];
}

function findAnsweredWorkFold(
  items: TranscriptTurnItem[],
  blocks: ContentBlock[],
  backgroundToolIds: ReadonlySet<string>,
): ActivityTimeline['fold'] {
  let end = -1;
  let answered = false;
  const yieldedAt = findYieldedAt(items, blocks, backgroundToolIds);
  for (let index = yieldedAt - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type === 'block') {
      const block = blocks[item.blockIndex];
      if (block.type === 'text' && block.content.trim()) answered = true;
    } else if (answered && isFoldableItem(item)) {
      end = index;
      break;
    }
  }
  if (end < 0) return undefined;

  let start = end;
  while (start > 0 && !items[start].boundaryBefore && isFoldableItem(items[start - 1])) {
    start -= 1;
  }
  return { start, end };
}

function findYieldedAt(
  items: TranscriptTurnItem[],
  blocks: ContentBlock[],
  backgroundToolIds: ReadonlySet<string>,
): number {
  if (backgroundToolIds.size === 0) return items.length;
  const yieldedIndex = items.findIndex((item, index) => {
    if (item.type !== 'activity') return false;
    const previous = items[index - 1];
    const followsNarration = previous?.type === 'block'
      && blocks[previous.blockIndex]?.type === 'text';
    return followsNarration && item.phases.some((phase) => phase.stepIndexes.some((blockIndex) => {
      const block = blocks[blockIndex];
      return block.type === 'tool_use' && backgroundToolIds.has(block.toolId);
    }));
  });
  return yieldedIndex < 0 ? items.length : yieldedIndex;
}

function isFoldableItem(item: TranscriptTurnItem): boolean {
  if (item.type === 'activity' || item.type === 'subagents') return true;
  return item.foldable;
}

/** Keep later narration and work in the same live fold until an actionable boundary. */
function extendLiveWorkFold(
  items: TranscriptTurnItem[],
  fold: NonNullable<ActivityTimeline['fold']>,
): NonNullable<ActivityTimeline['fold']> {
  let end = fold.end;
  let hasLaterActivity = false;
  for (let index = end + 1; index < items.length; index += 1) {
    const item = items[index];
    if (item.boundaryBefore || item.type === 'subagents' || !isFoldableItem(item)) break;
    end = index;
    if (item.type === 'activity') hasLaterActivity = true;
  }
  return hasLaterActivity ? { start: fold.start, end } : fold;
}

function isActivityBlock(block: ContentBlock, pendingToolIds: ReadonlySet<string>): boolean {
  if (block.type === 'thinking') return !!block.content.trim();
  if (block.type === 'tool_use') return !pendingToolIds.has(block.toolId);
  if (block.type === 'subagent') return !pendingToolIds.has(block.subagentId);
  return block.type === 'context_compacted';
}

/** Hide an opening private thought once readable prose arrives before any work. */
export function getSupersededInitialThinkingIndexes(blocks: ContentBlock[]): Set<number> {
  let end = 0;
  while (end < blocks.length && blocks[end].type === 'thinking') end += 1;
  if (end === 0) return new Set();

  const following = blocks.slice(end);
  const proseIndex = following.findIndex(
    (block) => block.type === 'text' && !!block.content.trim(),
  );
  if (proseIndex < 0) return new Set();
  const toolIndex = following.findIndex(
    (block) => block.type === 'tool_use' || block.type === 'subagent',
  );
  if (toolIndex >= 0 && toolIndex < proseIndex) return new Set();

  return new Set(Array.from({ length: end }, (_, index) => index));
}

function isFailedSubagent(block: ContentBlock, failedSubagentIds: ReadonlySet<string>): boolean {
  return block.type === 'subagent' && failedSubagentIds.has(block.subagentId);
}

function getPhaseKind(
  blocks: ContentBlock[],
  indexes: number[],
  toolNames: ReadonlyMap<string, string> = new Map(),
): ActivityWorkKind {
  const counts = new Map<ActivityWorkKind, number>();
  let hasThinking = false;
  let hasCompaction = false;
  for (const index of indexes) {
    const block = blocks[index];
    if (block.type === 'thinking') {
      hasThinking = true;
    } else if (block.type === 'context_compacted') {
      hasCompaction = true;
    } else if (block.type === 'subagent') {
      counts.set('agent', (counts.get('agent') ?? 0) + 1);
    } else if (block.type === 'tool_use') {
      const kind = getToolWorkKind(toolNames.get(block.toolId));
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }

  const priority: ActivityWorkKind[] = ['edit', 'run', 'agent', 'research', 'other'];
  let dominant: ActivityWorkKind | undefined;
  for (const kind of priority) {
    const count = counts.get(kind) ?? 0;
    if (count > 0 && (!dominant || count > (counts.get(dominant) ?? 0))) dominant = kind;
  }
  if (dominant) return dominant;
  return hasThinking ? 'think' : hasCompaction ? 'note' : 'other';
}

function getToolWorkKind(name?: string): ActivityWorkKind {
  if (!name) return 'other';
  if (isWriteEditTool(name) || name === TOOL_NOTEBOOK_EDIT || name === TOOL_APPLY_PATCH) return 'edit';
  if ([TOOL_BASH, TOOL_BASH_OUTPUT, TOOL_KILL_SHELL, 'exec', 'exec_command'].includes(name)) return 'run';
  if (name === TOOL_SUBAGENT || isAgentLifecycleTool(name)) return 'agent';
  if ([
    TOOL_READ,
    TOOL_WEB_FETCH,
    TOOL_GREP,
    TOOL_GLOB,
    TOOL_LS,
    TOOL_WEB_SEARCH,
    'Search',
  ].includes(name)) return 'research';
  if (name === TOOL_WRITE || name === TOOL_EDIT) return 'edit';
  return 'other';
}
