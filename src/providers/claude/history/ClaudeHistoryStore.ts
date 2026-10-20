import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { ProviderHistoryPathContext } from '../../../core/providers/types';
import type { ChatMessage, SubagentInfo, ToolCallInfo } from '../../../core/types';
import { extractHandbackResult } from '../normalization/claudeSubagentResult';
import { ClaudeTaskToolNormalizer } from '../normalization/ClaudeTaskToolNormalizer';
import { ClaudeTaskResultInterpreter } from '../runtime/ClaudeTaskResultInterpreter';
import { isClaudeSubagentToolName } from '../subagentToolNames';
import { ClaudeTurnStats } from './ClaudeTurnStats';
import { buildAsyncSubagentInfo } from './sdkAsyncSubagent';
import { filterActiveBranch } from './sdkBranchFilter';
import type { SDKNativeMessage, SDKSessionLoadResult } from './sdkHistoryTypes';
import {
  collectAsyncSubagentResults,
  collectStructuredPatchResults,
  collectToolResults,
  extractXmlTag,
  getSdkUserMessageTimestamp,
  hydrateFallbackAskUserAnswers,
  hydrateStructuredToolResults,
  isCanonicalSdkUserMessage,
  isQueuedPromptAttachment,
  isSystemInjectedMessage,
  mergeAssistantMessage,
  parseSDKMessageToChat,
  parseTaskNotification,
} from './sdkMessageParsing';
import {
  encodeVaultPathForSDK,
  getSDKProjectsPath,
  getSDKSessionAvailability,
  getSDKSessionPath,
  getSDKSessionSignature,
  isValidSessionId,
  locateSDKSession,
  locateSDKSessions,
  readSDKSession,
  readSDKSessionFile,
  sdkSessionExists,
} from './sdkSessionPaths';
import {
  getSubagentSidecarPath,
  hasSubagentSidecar,
  isValidAgentId,
  loadSubagentFinalResult,
  loadSubagentToolCalls,
  readSubagentToolUseIndex,
  type SubagentRunWindow,
} from './sdkSubagentSidecar';

export type {
  ClaudeSessionTimeCandidate,
  ClaudeSessionTimeFingerprint,
} from './ClaudeSessionRecovery';
export {
  recoverSDKSessionIdByTime,
  selectClaudeSessionRecoveryCandidate,
} from './ClaudeSessionRecovery';
export type {
  AsyncSubagentResult,
  ResolvedAsyncStatus,
  SDKNativeContentBlock,
  SDKNativeMessage,
  SDKSessionLoadResult,
  SDKSessionReadResult,
} from './sdkHistoryTypes';
export {
  collectAsyncSubagentResults,
  encodeVaultPathForSDK,
  extractXmlTag,
  filterActiveBranch,
  getSDKProjectsPath,
  getSDKSessionAvailability,
  getSDKSessionPath,
  getSDKSessionSignature,
  hasSubagentSidecar,
  isValidSessionId,
  loadSubagentFinalResult,
  loadSubagentToolCalls,
  locateSDKSession,
  locateSDKSessions,
  parseSDKMessageToChat,
  readSDKSession,
  readSDKSessionFile,
  readSubagentToolUseIndex,
  sdkSessionExists,
};
export {
  extractAgentIdFromToolUseResult,
  resolveToolUseResultStatus,
} from './sdkAsyncSubagent';

export function parseLegacyConversationSessionId(
  content: string,
  conversationId: string,
): string | null {
  const firstLine = content.split(/\r?\n/, 1)[0];
  if (!firstLine) {
    return null;
  }

  try {
    const record = JSON.parse(firstLine) as {
      type?: unknown;
      id?: unknown;
      sessionId?: unknown;
    };
    if (
      record.type !== 'meta'
      || record.id !== conversationId
      || typeof record.sessionId !== 'string'
      || !isValidSessionId(record.sessionId)
    ) {
      return null;
    }
    return record.sessionId;
  } catch {
    return null;
  }
}

export async function readLegacyConversationSessionId(
  vaultPath: string,
  conversationId: string,
): Promise<string | null> {
  if (!isValidSessionId(conversationId)) {
    return null;
  }

  try {
    const content = await fs.readFile(
      path.join(vaultPath, '.claude', 'sessions', `${conversationId}.jsonl`),
      'utf8',
    );
    return parseLegacyConversationSessionId(content, conversationId);
  } catch {
    return null;
  }
}

export async function loadSDKSessionMessages(
  vaultPath: string,
  sessionId: string,
  resumeAtMessageId?: string,
  sessionPath?: string,
  pathContext?: ProviderHistoryPathContext,
): Promise<SDKSessionLoadResult> {
  const result = sessionPath
    ? await readSDKSessionFile(sessionPath)
    : await (pathContext
      ? readSDKSession(vaultPath, sessionId, pathContext)
      : readSDKSession(vaultPath, sessionId));

  if (result.error) {
    return { messages: [], skippedLines: result.skippedLines, error: result.error };
  }

  const messages = await assembleSDKChatMessages(vaultPath, sessionId, result.messages, {
    resumeAtMessageId,
    sessionPath,
    pathContext,
  });
  return { messages, skippedLines: result.skippedLines };
}

/**
 * Assembles raw SDK transcript entries into {@link ChatMessage}s, merging
 * consecutive assistant turns and hydrating tool results and async subagents.
 * Shared by main-session replay and subagent transcript replay.
 */
async function assembleSDKChatMessages(
  vaultPath: string,
  sessionId: string,
  entries: SDKNativeMessage[],
  options?: {
    resumeAtMessageId?: string;
    sessionPath?: string;
    pathContext?: ProviderHistoryPathContext;
  },
): Promise<ChatMessage[]> {
  const resumeAtMessageId = options?.resumeAtMessageId;
  const sessionPath = options?.sessionPath;
  const pathContext = options?.pathContext;

  const filteredEntries = filterActiveBranch(entries.filter(entry => !entry.isSidechain), resumeAtMessageId);
  const manualCompactBoundaryIds = collectManualCompactBoundaryIds(filteredEntries);
  const realUserMessageIds = new Set(
    filteredEntries
      .filter(isRealUserInput)
      .flatMap((entry) => entry.uuid ? [entry.uuid] : []),
  );

  const toolResults = collectToolResults(filteredEntries);
  const toolUseResults = collectStructuredPatchResults(filteredEntries);
  const asyncSubagentResults = collectAsyncSubagentResults(filteredEntries);
  const nativeTurnDurations = collectNativeTurnDurations(entries);

  const chatMessages: ChatMessage[] = [];
  let pendingAssistant: ChatMessage | null = null;
  let turnStartedAt: number | undefined;
  let lastAssistantAt: number | undefined;
  let requestedResponsePending = false;
  let turnStats = new ClaudeTurnStats();
  const taskToolNormalizer = new ClaudeTaskToolNormalizer();

  const flushPendingAssistant = (includeDuration: boolean): void => {
    if (pendingAssistant) {
      const nativeDuration = pendingAssistant.assistantMessageId
        ? nativeTurnDurations.get(pendingAssistant.assistantMessageId)
        : undefined;
      if (includeDuration && nativeDuration !== undefined && nativeDuration > 0) {
        if (!pendingAssistant.isAutomaticResponse) {
          pendingAssistant.durationSeconds = Math.floor(nativeDuration / 1_000);
        }
      }
      if (includeDuration && nativeDuration === undefined && !pendingAssistant.isAutomaticResponse
        && turnStartedAt !== undefined && lastAssistantAt !== undefined
        && lastAssistantAt >= turnStartedAt) {
        pendingAssistant.durationSeconds = Math.floor((lastAssistantAt - turnStartedAt) / 1_000);
      }
      if (includeDuration) {
        pendingAssistant.turnStats = turnStats.finish(turnStartedAt, lastAssistantAt);
      }
      chatMessages.push(pendingAssistant);
    }
    pendingAssistant = null;
    lastAssistantAt = undefined;
    turnStartedAt = undefined;
    requestedResponsePending = false;
    turnStats = new ClaudeTurnStats();
  };

  // Progress parents disappear from the active projection but still date queued prompts.
  const effectiveTimestamps = new Map<string, string | undefined>();
  for (const entry of entries) {
    if (entry.isSidechain || !entry.uuid) continue;
    effectiveTimestamps.set(entry.uuid, getSdkUserMessageTimestamp(
      entry, entry.parentUuid ? effectiveTimestamps.get(entry.parentUuid) : undefined,
    ));
  }
  // Preserve task notification boundaries without ending an unfinished response.
  for (const entry of filteredEntries) {
    const timestamp = isQueuedPromptAttachment(entry) && entry.uuid && effectiveTimestamps.has(entry.uuid)
      ? effectiveTimestamps.get(entry.uuid) : entry.timestamp;
    const sdkMsg = timestamp === entry.timestamp ? entry : { ...entry, timestamp };
    const notification = parseTaskNotification(sdkMsg);
    if (notification !== null) {
      if (pendingAssistant && requestedResponsePending) {
        pendingAssistant.contentBlocks = pendingAssistant.contentBlocks ?? [];
        pendingAssistant.contentBlocks.push({ type: 'task_notification', content: notification });
        continue;
      }
      const requestedStartedAt: number | undefined = pendingAssistant ? undefined : turnStartedAt;
      flushPendingAssistant(true);
      turnStartedAt = requestedStartedAt;
      requestedResponsePending = requestedStartedAt !== undefined;
      pendingAssistant = {
        id: sdkMsg.uuid ?? `task-notification-${chatMessages.length}`,
        role: 'assistant',
        isAutomaticResponse: requestedStartedAt === undefined,
        content: '',
        timestamp: parseSDKTimestamp(sdkMsg.timestamp),
        contentBlocks: [{ type: 'task_notification', content: notification }],
      };
      continue;
    }
    if (isSystemInjectedMessage(sdkMsg)) continue;

    // Skip synthetic assistant messages (e.g., "No response requested." after /compact)
    if (sdkMsg.type === 'assistant' && sdkMsg.message?.model === '<synthetic>') continue;

    const chatMsg = parseSDKMessageToChat(sdkMsg, toolResults);
    if (!chatMsg) continue;
    normalizeTaskToolCalls(chatMsg, taskToolNormalizer, toolUseResults);

    if (chatMsg.role === 'assistant') {
      // A compact boundary can arrive between tool/thinking output and the final
      // answer of the same user turn. Keep it as an ordered content block rather
      // than flushing the turn into separate assistant messages.
      const isCompactBoundary = chatMsg.contentBlocks?.some(b => b.type === 'context_compacted');
      const isManualCompactBoundary = isCompactBoundary
        && !!sdkMsg.uuid
        && manualCompactBoundaryIds.has(sdkMsg.uuid);
      if (isCompactBoundary && (isManualCompactBoundary || !pendingAssistant)) {
        flushPendingAssistant(true);
        chatMessages.push(chatMsg);
      } else if (pendingAssistant) {
        mergeAssistantMessage(pendingAssistant, chatMsg);
      } else {
        pendingAssistant = chatMsg;
      }
      turnStats.add(sdkMsg);
      lastAssistantAt = parseSDKTimestamp(sdkMsg.timestamp);
      requestedResponsePending = turnStartedAt !== undefined
        && sdkMsg.message?.stop_reason === 'tool_use';
    } else {
      flushPendingAssistant(!chatMsg.isInterrupt);
      if (isCanonicalSdkUserMessage(sdkMsg)) {
        turnStartedAt = parseSDKTimestamp(sdkMsg.timestamp);
      }
      chatMessages.push(chatMsg);
    }
  }

  flushPendingAssistant(true);

  const taskResults = new ClaudeTaskResultInterpreter();
  const sidecarLoads: Array<{ subagent: SubagentInfo; promise: Promise<ToolCallInfo[]> }> = [];
  const loadSidecarToolCalls = (subagent: SubagentInfo, runWindow?: SubagentRunWindow): void => {
    if (!subagent.agentId || !isValidAgentId(subagent.agentId)) return;
    sidecarLoads.push({
      subagent,
      promise: loadSubagentToolCalls(vaultPath, sessionId, subagent.agentId, sessionPath, pathContext, runWindow),
    });
  };
  const reportLoads: Array<{ subagent: SubagentInfo; toolCall: ToolCallInfo; promise: Promise<string | null> }> = [];
  const toolTimes = collectToolTimes(filteredEntries);
  for (const message of chatMessages) {
    for (const toolCall of message.toolCalls ?? []) {
      if (!isClaudeSubagentToolName(toolCall.name) || toolCall.input.run_in_background === true
        || toolCall.result === undefined) continue;
      const metadata = toolUseResults.get(toolCall.id);
      if (taskResults.hasAsyncLaunchMarker(metadata) || toolCall.subagent?.mode === 'async') continue;
      const agentId = taskResults.extractAgentId(metadata) ?? taskResults.extractAgentId(toolCall.result);
      const result = {
        result: taskResults.extractStructuredResult(metadata) ?? extractHandbackResult(toolCall.result) ?? toolCall.result,
        status: taskResults.resolveTerminalStatus(metadata, toolCall.status === 'error' ? 'error' : 'completed'),
      };
      toolCall.result = result.result;
      if (toolCall.subagent?.result !== undefined) {
        toolCall.subagent.result = extractHandbackResult(toolCall.subagent.result) ?? toolCall.subagent.result;
      }
      if (!toolCall.subagent && agentId) {
        toolCall.subagent = {
          id: toolCall.id,
          description: (toolCall.input.description as string) || 'Subagent task',
          prompt: (toolCall.input.prompt as string) || '',
          mode: 'sync',
          isExpanded: false,
          status: result.status,
          result: result.result,
          toolCalls: [],
          agentId,
        };
        // Continuations and reuse append later runs; replay only this invocation's activity.
        const startedAt = toolTimes.uses.get(toolCall.id);
        const endedAt = toolTimes.results.get(toolCall.id);
        loadSidecarToolCalls(toolCall.subagent, startedAt !== undefined && endedAt !== undefined
          ? { startedAt, endedAt } : undefined);
      }
    }
  }

  hydrateStructuredToolResults(chatMessages, toolUseResults);
  hydrateFallbackAskUserAnswers(chatMessages);

  // Build SubagentInfo for async Agent tool calls from toolUseResult + queue-operation data
  if (toolUseResults.size > 0 || asyncSubagentResults.size > 0) {
    for (const msg of chatMessages) {
      if (msg.role !== 'assistant' || !msg.toolCalls) continue;
      for (const toolCall of msg.toolCalls) {
        if (!isClaudeSubagentToolName(toolCall.name)) continue;
        if (toolCall.subagent) continue;
        if (toolCall.input?.run_in_background !== true) continue;

        const toolUseResult = toolUseResults.get(toolCall.id);
        const subagent = buildAsyncSubagentInfo(
          toolCall,
          toolUseResult,
          asyncSubagentResults
        );
        if (subagent) {
          toolCall.subagent = subagent;
          if (subagent.result !== undefined) {
            toolCall.result = subagent.result;
          }
          toolCall.status = subagent.status;
          loadSidecarToolCalls(subagent);
          if (subagent.agentId && isValidAgentId(subagent.agentId)
            && asyncSubagentResults.get(subagent.agentId)?.summaryOnly) {
            reportLoads.push({
              subagent,
              toolCall,
              promise: loadSubagentFinalResult(vaultPath, sessionId, subagent.agentId, sessionPath, pathContext),
            });
          }
        }
      }
    }
  }

  // Hydrate subagent tool calls from sidecar files in parallel
  const sidecarToolCalls = await Promise.all(sidecarLoads.map(load => load.promise));
  sidecarLoads.forEach(({ subagent }, index) => {
    if (sidecarToolCalls[index].length > 0) subagent.toolCalls = sidecarToolCalls[index];
  });
  // A summary-only notice defers to the sidecar's final report, as live completion recovery does.
  const reports = await Promise.all(reportLoads.map(load => load.promise));
  reportLoads.forEach(({ subagent, toolCall }, index) => {
    const report = reports[index]?.trim();
    if (!report) return;
    subagent.result = report;
    toolCall.result = report;
  });

  // Notification timestamps record enqueue time, not consumption. Pin their
  // transcript boundaries while retaining timestamp ordering (e.g. /compact)
  // within each intervening section.
  let sectionStart = 0;
  for (let index = 0; index <= chatMessages.length; index++) {
    if (index < chatMessages.length
      && !chatMessages[index].contentBlocks?.some(block => block.type === 'task_notification')) continue;
    const section = chatMessages.slice(sectionStart, index).sort((a, b) => a.timestamp - b.timestamp);
    for (let offset = 0; offset < section.length; offset++) {
      chatMessages[sectionStart + offset] = section[offset];
    }
    sectionStart = index + 1;
  }
  applyTranscriptDurationFallback(chatMessages, realUserMessageIds);

  return chatMessages;
}

/**
 * Manual `/compact` records its boundary after the command by timestamp, but
 * the JSONL append order can be the reverse. Preserve that explicit command
 * boundary as its own message; automatic compaction stays inside its turn.
 */
function collectManualCompactBoundaryIds(entries: SDKNativeMessage[]): Set<string> {
  const orderedEntries = entries
    .map((entry, index) => ({ entry, index, timestamp: parseSDKTimestamp(entry.timestamp) }))
    .sort((left, right) => left.timestamp - right.timestamp || left.index - right.index);
  const boundaryIds = new Set<string>();
  let awaitingManualCompactBoundary = false;

  for (const { entry } of orderedEntries) {
    if (entry.type === 'user' && !isSystemInjectedMessage(entry)) {
      awaitingManualCompactBoundary = isManualCompactCommand(entry);
      continue;
    }
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      if (awaitingManualCompactBoundary && entry.uuid) {
        boundaryIds.add(entry.uuid);
      }
      awaitingManualCompactBoundary = false;
    }
  }

  return boundaryIds;
}

function isManualCompactCommand(entry: SDKNativeMessage): boolean {
  const content = entry.message?.content;
  const text = typeof content === 'string'
    ? content
    : content
      ?.filter((block): block is { type: 'text'; text: string } => (
        block.type === 'text' && typeof block.text === 'string'
      ))
      .map(block => block.text)
      .join('\n') ?? '';
  return /<command-name>\s*\/compact\s*<\/command-name>/i.test(text);
}

function parseSDKTimestamp(value: string | undefined): number {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function isRealUserInput(entry: SDKNativeMessage): boolean {
  return entry.type === 'user'
    && !entry.isMeta
    && !('toolUseResult' in entry)
    && !('sourceToolUseID' in entry);
}

function applyTranscriptDurationFallback(
  messages: ChatMessage[],
  realUserMessageIds: ReadonlySet<string>,
): void {
  let turnStartTimestamp: number | null = null;
  let finalAssistantMessage: ChatMessage | null = null;

  const applyFallback = () => {
    if (
      !finalAssistantMessage
      || finalAssistantMessage.durationSeconds !== undefined
      || turnStartTimestamp === null
    ) return;
    const durationSeconds = Math.floor(
      (finalAssistantMessage.timestamp - turnStartTimestamp) / 1_000,
    );
    if (durationSeconds > 0) {
      finalAssistantMessage.durationSeconds = durationSeconds;
    }
  };

  for (const message of messages) {
    if (message.role === 'user' && realUserMessageIds.has(message.id)) {
      applyFallback();
      turnStartTimestamp = message.timestamp;
      finalAssistantMessage = null;
    } else if (message.role === 'assistant' && turnStartTimestamp !== null) {
      finalAssistantMessage = message;
    }
  }
  applyFallback();
}

/**
 * Loads the full read-only transcript of an async subagent as chat messages by
 * replaying its sidecar JSONL (`agent-{agentId}.jsonl`). Returns null when the
 * sidecar is missing, the ids are invalid, or the file cannot be read.
 */
export async function loadSubagentConversation(
  vaultPath: string,
  sessionId: string,
  agentId: string,
  sessionPath?: string,
  pathContext?: ProviderHistoryPathContext,
): Promise<ChatMessage[] | null> {
  const subagentFilePath = getSubagentSidecarPath(
    vaultPath,
    sessionId,
    agentId,
    sessionPath,
    pathContext,
  );
  if (!subagentFilePath) {
    return null;
  }

  const result = await readSDKSessionFile(subagentFilePath);
  if (result.error) {
    return null;
  }

  return assembleSDKChatMessages(vaultPath, sessionId, result.messages, {
    sessionPath,
    pathContext,
  });
}

/** Native timestamps of each tool call and of its result, which bound a sync subagent run. */
function collectToolTimes(entries: SDKNativeMessage[]): { uses: Map<string, number>; results: Map<string, number> } {
  const uses = new Map<string, number>();
  const results = new Map<string, number>();
  for (const entry of entries) {
    const timestamp = parseNativeTimestamp(entry.timestamp);
    const content = entry.message?.content;
    if (timestamp === undefined || !Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_use' && block.id) uses.set(block.id, timestamp);
      if (block.type === 'tool_result' && block.tool_use_id) results.set(block.tool_use_id, timestamp);
    }
  }
  return { uses, results };
}

function parseNativeTimestamp(value: string | undefined): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function collectNativeTurnDurations(
  entries: SDKNativeMessage[],
): Map<string, number> {
  const durations = new Map<string, number>();
  const entriesByUuid = new Map<string, SDKNativeMessage>();
  for (const entry of entries) {
    if (entry.uuid && !entriesByUuid.has(entry.uuid)) {
      entriesByUuid.set(entry.uuid, entry);
    }
  }

  for (const entry of entries) {
    const durationMs = typeof entry.durationMs === 'number'
      ? entry.durationMs
      : entry.duration_ms;
    if (
      entry.type !== 'system'
      || entry.subtype !== 'turn_duration'
      || typeof entry.parentUuid !== 'string'
      || typeof durationMs !== 'number'
      || !Number.isFinite(durationMs)
      || durationMs < 0
    ) continue;

    const assistantUuid = resolveTurnDurationAssistantUuid(entry.parentUuid, entriesByUuid);
    if (assistantUuid) {
      durations.set(assistantUuid, durationMs);
    }
  }
  return durations;
}

function resolveTurnDurationAssistantUuid(
  parentUuid: string,
  entriesByUuid: ReadonlyMap<string, SDKNativeMessage>,
): string | null {
  const seen = new Set<string>();
  let currentUuid: string | null = parentUuid;
  while (currentUuid && !seen.has(currentUuid)) {
    seen.add(currentUuid);
    const entry = entriesByUuid.get(currentUuid);
    if (!entry) return null;
    if (entry.type === 'assistant') return currentUuid;
    if (entry.type !== 'system') return null;
    currentUuid = typeof entry.parentUuid === 'string' ? entry.parentUuid : null;
  }
  return null;
}

export function getLastSDKSessionModel(
  entries: SDKNativeMessage[],
  resumeAtMessageId?: string,
): string | null {
  const activeBranch = filterActiveBranch(entries, resumeAtMessageId);
  if (
    resumeAtMessageId
    && !activeBranch.some(entry => entry.uuid === resumeAtMessageId)
  ) {
    return null;
  }

  let model: string | null = null;
  for (const entry of activeBranch) {
    const candidate = entry.type === 'assistant'
      ? entry.message?.model?.trim()
      : '';
    if (candidate && candidate !== '<synthetic>') {
      model = candidate;
    }
  }
  return model;
}

export async function loadSDKSessionModel(
  vaultPath: string,
  sessionId: string,
  resumeAtMessageId?: string,
  sessionPath?: string,
  pathContext?: ProviderHistoryPathContext,
): Promise<string | null> {
  const result = sessionPath
    ? await readSDKSessionFile(sessionPath)
    : await (pathContext
      ? readSDKSession(vaultPath, sessionId, pathContext)
      : readSDKSession(vaultPath, sessionId));
  return result.error
    ? null
    : getLastSDKSessionModel(result.messages, resumeAtMessageId);
}

function normalizeTaskToolCalls(
  message: ChatMessage,
  normalizer: ClaudeTaskToolNormalizer,
  toolUseResults: Map<string, unknown>,
): void {
  if (message.role !== 'assistant' || !message.toolCalls) return;

  for (const toolCall of message.toolCalls) {
    const normalizedUse = normalizer.normalizeToolUse(
      toolCall.id,
      toolCall.name,
      toolCall.input,
    );
    if (!normalizedUse) continue;

    const rawOutput = toolUseResults.get(toolCall.id);
    const normalizedResult = toolCall.status === 'running'
      ? null
      : normalizer.normalizeToolResult(toolCall.id, rawOutput, {
        fallbackContent: toolCall.result,
        isError: toolCall.status === 'error' || toolCall.status === 'blocked',
      });
    const normalized = normalizedResult ?? normalizedUse;
    toolCall.name = normalized.name;
    toolCall.input = normalized.input;
    toolCall.providerPayload = {
      ...toolCall.providerPayload,
      ...normalized.providerPayload,
    };
  }
}
