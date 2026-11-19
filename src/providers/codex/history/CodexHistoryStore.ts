import * as fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { forEachJSONLLine } from '@/utils/jsonlFile';

import type {
  ChatMessage,
  CitationGroup,
  ContentBlock,
  ImageAttachment,
  SubagentInfo,
  ToolCallInfo,
  ToolExplorationAction,
  ToolResultImage,
} from '../../../core/types';
import { createTurnStats, isTokenCount } from '../../../core/types';
import { extractUserDisplayContent } from '../../../utils/context';
import {
  buildImageAttachmentFromBase64,
  parseImageDataUri,
} from '../../../utils/imageAttachment';
import {
  extractCodexUserVisibleText,
  getCodexStopHookFeedback,
  joinCodexUserTextParts,
  trimCodexUserText,
} from '../codexUserText';
import {
  normalizeCodexMemoryCitation,
  stripCodexMemoryCitationMarkup,
} from '../normalization/CodexMemoryCitation';
import { parseCodexQuestionReply } from '../normalization/codexQuestionNormalization';
import { applyCodexSubagentActivity, normalizeCodexSubagentActivity } from '../normalization/codexSubagentActivity';
import { buildCodexSubagentInfo } from '../normalization/codexSubagentNormalization';
import {
  appendCodexCommandOutput,
  codexScriptToolNamesMatch,
  codexToolRequestsMatch,
  decodeCodexExecEnvelopeCalls,
  extractCodexExecCellId,
  formatCodexWebSearchResults,
  isCodexInternalToolCall,
  isCodexToolOutputError,
  normalizeCodexMcpToolCompletion,
  normalizeCodexMcpToolInput,
  normalizeCodexMcpToolName,
  normalizeCodexMcpToolState,
  normalizeCodexToolCall,
  normalizeCodexToolInput,
  normalizeCodexToolName,
  normalizeCodexToolResult,
  type NormalizedCodexToolCall,
  parseCodexArguments,
  readCodexExecCellIdArgument,
  stringifyCodexToolOutput,
} from '../normalization/codexToolNormalization';
import {
  presentCodexCommand,
  presentCodexFileChange,
  presentCodexImageTool,
  presentCodexMcpToolCall,
} from '../normalization/CodexToolPresentation';
import { formatCodexModelLabel } from '../types/models';
import { recoverCodexInputContext } from './CodexInputContext';

interface CodexEvent {
  type: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: { input_tokens: number; cached_input_tokens: number; output_tokens: number };
  error?: { message: string };
  message?: string;
}

interface CodexItem {
  id: string;
  type: string;
  text?: string;
  command?: string;
  commandActions?: unknown[];
  cwd?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
  changes?: Array<{ path: string; kind: string }>;
  query?: string;
  message?: string;
  server?: string;
  tool?: string;
  arguments?: string | Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

interface PersistedMessagePart {
  image_url?: string | { url?: string };
  type?: string;
  text?: string;
}

interface PersistedMessagePayload {
  type: 'message';
  id?: string;
  role?: string;
  content?: PersistedMessagePart[];
}

interface PersistedReasoningPayload {
  type: 'reasoning';
  summary?: Array<{ type?: string; text?: string } | string>;
  content?: Array<{ type?: string; text?: string } | string>;
  text?: string;
}

interface PersistedToolCallPayload {
  type: 'function_call' | 'custom_tool_call';
  name?: string;
  namespace?: unknown;
  arguments?: string;
  call_id?: string;
  input?: string;
}

interface PersistedToolCallOutputPayload {
  type: 'function_call_output' | 'custom_tool_call_output';
  call_id?: string;
  output?: string | unknown[];
}

interface PersistedWebSearchCallPayload {
  type: 'web_search_call';
  action?: {
    type?: string;
    query?: string;
    queries?: string[];
    url?: string;
    pattern?: string;
  };
  status?: string;
  call_id?: string;
}

interface PersistedMcpToolCallPayload {
  type: 'mcp_tool_call';
  server?: string;
  tool?: string;
  call_id?: string;
  status?: string;
  arguments?: string | Record<string, unknown>;
  result?: { content?: Array<{ type?: string; text?: string }> } | null;
  error?: { message: string } | string | null;
  duration_ms?: number | null;
}

interface PersistedEventPayload {
  item?: Record<string, unknown> & {
    type?: string;
    id?: string;
    delivery?: string;
    questions?: unknown[];
    fragments?: unknown;
  };
  type?: string;
  text?: string;
  message?: string;
  memory_citation?: unknown;
  memoryCitation?: unknown;
}

interface PersistedCompactionPayload {
  type: 'compaction';
  encrypted_content?: string;
}

export interface CodexSessionRecord {
  timestamp: number;
  type?: string;
  event?: CodexEvent;
  payload?: PersistedPayload;
}

// ---------------------------------------------------------------------------
// Multi-bubble turn model
// ---------------------------------------------------------------------------

interface CodexAssistantBubble {
  contentChunks: string[];
  thinkingChunks: string[];
  toolCalls: ToolCallInfo[];
  toolIndexesById: Map<string, number>;
  contentBlocks: ContentBlock[];
  startedAt: number;
  lastEventAt: number;
  interrupted: boolean;
}

interface CodexTurnState {
  id: string;
  serverTurnId?: string;
  modelName?: string;
  startedAt: number;
  completedAt?: number;
  completed?: boolean;
  outputTokens?: number;
  durationMs?: number;
  lastEventAt: number;
  userTimestamp?: number;
  userChunks: string[];
  userImages: ImageAttachment[];
  assistantBubbles: CodexAssistantBubble[];
  activeBubbleIndex: number | null;
}

type PersistedPayload =
  | PersistedMessagePayload
  | PersistedReasoningPayload
  | PersistedToolCallPayload
  | PersistedToolCallOutputPayload
  | PersistedWebSearchCallPayload
  | PersistedMcpToolCallPayload
  | PersistedCompactionPayload
  | PersistedEventPayload
  | undefined;

// ---------------------------------------------------------------------------
// Turn/bubble lifecycle helpers
// ---------------------------------------------------------------------------

function newBubble(timestamp: number): CodexAssistantBubble {
  return {
    contentChunks: [],
    thinkingChunks: [],
    toolCalls: [],
    toolIndexesById: new Map(),
    contentBlocks: [],
    startedAt: timestamp,
    lastEventAt: timestamp,
    interrupted: false,
  };
}

function newTurnState(id: string, timestamp: number): CodexTurnState {
  return {
    id,
    startedAt: timestamp,
    lastEventAt: timestamp,
    userChunks: [],
    userImages: [],
    assistantBubbles: [],
    activeBubbleIndex: null,
  };
}

function createPersistedParseContext(): PersistedParseContext {
  return {
    turns: new Map(),
    turnOrder: [],
    currentTurnId: null,
    toolCallToTurn: new Map(),
    suppressedToolOutputIds: new Set(),
    terminalSessionToCommandId: new Map(),
    pendingStdinCalls: new Map(),
    execCellToCommandId: new Map(),
    execEnvelopeToolCallIds: new Map(),
    imageViewEnvelopeToolCallIds: new Map(),
    execEnvelopeInternalOutputCallIds: new Set(),
    nativeCommandResultCallIds: new Set(),
    nativeWebSearchResultCallIds: new Set(),
    nativeImageResultCallIds: new Set(),
    completedExecCallIds: new Set(),
    imageCallCandidates: new Map(),
    observedNativeItemIds: new Set(),
    nativeMessageCitations: new Map(),
    nativeCallCandidates: [],
    withheldExecCellIds: new Set(),
    withheldOutputCallIds: new Set(),
    failedExecCallIds: new Set(),
    waitCallToCommand: new Map(),
    turnCounter: 0,
  };
}

function ensureTurn(
  turns: Map<string, CodexTurnState>,
  turnOrder: string[],
  preferredTurnId: string,
  currentTurnId: string | null,
  timestamp: number,
): CodexTurnState {
  const id = currentTurnId ?? preferredTurnId;
  const existing = turns.get(id);
  if (existing) {
    if (timestamp > 0 && timestamp > existing.lastEventAt) {
      existing.lastEventAt = timestamp;
    }
    return existing;
  }

  const turn = newTurnState(id, timestamp);
  turns.set(id, turn);
  turnOrder.push(id);
  return turn;
}

function ensureAssistantBubble(turn: CodexTurnState, timestamp: number): CodexAssistantBubble {
  if (turn.activeBubbleIndex !== null) {
    const bubble = turn.assistantBubbles[turn.activeBubbleIndex];
    if (timestamp > 0 && timestamp > bubble.lastEventAt) {
      bubble.lastEventAt = timestamp;
    }
    return bubble;
  }

  const bubble = newBubble(timestamp);
  turn.assistantBubbles.push(bubble);
  turn.activeBubbleIndex = turn.assistantBubbles.length - 1;
  return bubble;
}

function closeAssistantBubble(turn: CodexTurnState): void {
  turn.activeBubbleIndex = null;
}

function pushToolInvocation(bubble: CodexAssistantBubble, toolCall: ToolCallInfo): void {
  const existingIndex = bubble.toolIndexesById.get(toolCall.id);
  if (existingIndex !== undefined) {
    bubble.toolCalls[existingIndex] = toolCall;
    return;
  }

  bubble.toolIndexesById.set(toolCall.id, bubble.toolCalls.length);
  bubble.toolCalls.push(toolCall);
  bubble.contentBlocks.push({ type: 'tool_use', toolId: toolCall.id });
}

function appendUniqueChunk(chunks: string[], value: string): void {
  const trimmed = trimCodexUserText(value);
  if (!trimmed) return;
  if (chunks[chunks.length - 1] === trimmed) return;
  chunks.push(trimmed);
}

function appendOrderedTextChunk(
  bubble: CodexAssistantBubble,
  type: 'text' | 'thinking',
  value: string,
): void {
  const trimmed = value.trim();
  if (!trimmed) return;

  const chunks = type === 'text' ? bubble.contentChunks : bubble.thinkingChunks;
  const lastBlock = bubble.contentBlocks[bubble.contentBlocks.length - 1];
  if (lastBlock?.type === type) {
    if (chunks[chunks.length - 1] === trimmed) return;

    chunks.push(trimmed);
    lastBlock.content = `${lastBlock.content}\n\n${trimmed}`;
    return;
  }

  chunks.push(trimmed);
  bubble.contentBlocks.push({ type, content: trimmed });
}

function appendCitationBlock(bubble: CodexAssistantBubble, citations: CitationGroup | null | undefined): void {
  if (!citations) return;

  const lastBlock = bubble.contentBlocks[bubble.contentBlocks.length - 1];
  if (
    lastBlock?.type === 'citations'
    && areCitationGroupsEqual(lastBlock.citations, citations)
  ) {
    return;
  }
  bubble.contentBlocks.push({ type: 'citations', citations });
}

function areCitationGroupsEqual(left: CitationGroup, right: CitationGroup): boolean {
  return left.kind === right.kind
    && left.entries.length === right.entries.length
    && left.entries.every((entry, index) => {
      const other = right.entries[index];
      return entry.path === other.path
        && entry.lineStart === other.lineStart
        && entry.lineEnd === other.lineEnd
        && entry.note === other.note;
    });
}

function appendPersistedAssistantText(
  bubble: CodexAssistantBubble,
  value: string,
): void {
  const trimmed = value.trim();
  if (!trimmed) return;

  const lastBlock = bubble.contentBlocks[bubble.contentBlocks.length - 1];
  const previousBlock = bubble.contentBlocks[bubble.contentBlocks.length - 2];
  if (
    lastBlock?.type === 'citations'
    && previousBlock?.type === 'text'
    && bubble.contentChunks.at(-1) === trimmed
  ) {
    return;
  }
  appendOrderedTextChunk(bubble, 'text', trimmed);
}

function replaceLatestOrderedTextChunk(
  bubble: CodexAssistantBubble,
  type: 'text' | 'thinking',
  value: string,
): void {
  const trimmed = value.trim();
  if (!trimmed) return;

  const chunks = type === 'text' ? bubble.contentChunks : bubble.thinkingChunks;
  const lastBlock = bubble.contentBlocks[bubble.contentBlocks.length - 1];
  if (lastBlock?.type !== type || chunks.length === 0) {
    appendOrderedTextChunk(bubble, type, trimmed);
    return;
  }

  chunks[chunks.length - 1] = trimmed;
  lastBlock.content = trimmed;
}

function appendUserChunk(turn: CodexTurnState, value: string, timestamp: number): void {
  const chunkCountBefore = turn.userChunks.length;
  appendUniqueChunk(turn.userChunks, value);

  if (turn.userChunks.length > chunkCountBefore && !turn.userTimestamp && timestamp > 0) {
    turn.userTimestamp = timestamp;
  }
}

function appendUserImages(
  turn: CodexTurnState,
  content: PersistedMessagePart[] | undefined,
  timestamp: number,
): void {
  const images = extractMessageImages(content, `codex-img-${turn.id}`, turn.userImages.length);
  if (images.length === 0) {
    return;
  }

  turn.userImages.push(...images);
  if (!turn.userTimestamp && timestamp > 0) {
    turn.userTimestamp = timestamp;
  }
}

// ---------------------------------------------------------------------------
// Legacy TurnAccumulator — kept for the `event` wrapper format
// ---------------------------------------------------------------------------

interface TurnAccumulator {
  assistantText: string;
  thinkingText: string;
  toolCalls: ToolCallInfo[];
  contentBlocks: ContentBlock[];
  interrupted: boolean;
  timestamp: number;
}

function newTurn(timestamp = 0): TurnAccumulator {
  return {
    assistantText: '',
    thinkingText: '',
    toolCalls: [],
    contentBlocks: [],
    interrupted: false,
    timestamp,
  };
}

function flushTurn(turn: TurnAccumulator, messages: ChatMessage[], msgIndex: number): number {
  if (
    !turn.assistantText &&
    !turn.thinkingText &&
    turn.toolCalls.length === 0
  ) {
    return msgIndex;
  }

  const msg: ChatMessage = {
    id: `codex-msg-${msgIndex}`,
    role: 'assistant',
    content: turn.assistantText,
    timestamp: turn.timestamp || Date.now(),
    toolCalls: turn.toolCalls.length > 0 ? turn.toolCalls : undefined,
    contentBlocks: turn.contentBlocks.length > 0 ? turn.contentBlocks : undefined,
  };

  if (turn.interrupted) {
    msg.isInterrupt = true;
  }

  messages.push(msg);
  return msgIndex + 1;
}

function setTextBlock(turn: TurnAccumulator, content: string): void {
  const index = turn.contentBlocks.findIndex(block => block.type === 'text');
  if (index === -1) {
    turn.contentBlocks.push({ type: 'text', content });
    return;
  }

  turn.contentBlocks[index] = { type: 'text', content };
}

function setThinkingBlock(turn: TurnAccumulator, content: string): void {
  const normalized = content.trim();
  if (!normalized) {
    return;
  }

  turn.thinkingText = normalized;

  const index = turn.contentBlocks.findIndex(block => block.type === 'thinking');
  if (index === -1) {
    turn.contentBlocks.push({ type: 'thinking', content: normalized });
    return;
  }

  turn.contentBlocks[index] = { type: 'thinking', content: normalized };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function parseTimestamp(value: unknown): number {
  if (typeof value !== 'string') {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSessionRecord(line: string): CodexSessionRecord | null {
  let parsed: {
    timestamp?: string;
    type?: string;
    event?: CodexEvent;
    payload?: PersistedPayload;
  };

  try {
    parsed = JSON.parse(line) as typeof parsed;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  return {
    timestamp: parseTimestamp(parsed.timestamp),
    type: parsed.type,
    event: parsed.event,
    payload: parsed.payload,
  };
}

function extractMessageText(content: PersistedMessagePart[] | undefined): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map(part => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
}

function extractUserMessageText(content: PersistedMessagePart[] | undefined): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return joinCodexUserTextParts(
    content.map(part => (typeof part?.text === 'string' ? part.text : '')),
  );
}

function extractMessageImages(
  content: PersistedMessagePart[] | undefined,
  idPrefix: string,
  startIndex = 0,
): ImageAttachment[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const images: ImageAttachment[] = [];
  for (const part of content) {
    if (part?.type !== 'input_image') {
      continue;
    }

    const imageUrl = typeof part.image_url === 'string'
      ? part.image_url
      : typeof part.image_url?.url === 'string'
        ? part.image_url.url
        : null;
    const parsed = parseImageDataUri(imageUrl);
    if (!parsed) {
      continue;
    }

    const image = buildImageAttachmentFromBase64({
      data: parsed.data,
      id: `${idPrefix}-${startIndex + images.length}`,
      mediaType: parsed.mediaType,
      name: `image-${startIndex + images.length + 1}.${parsed.mediaType.split('/')[1]}`,
    });
    if (image) {
      images.push(image);
    }
  }

  return images;
}

function hasMessageImages(content: PersistedMessagePart[] | undefined): boolean {
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((part) => {
    if (part?.type !== 'input_image') {
      return false;
    }
    const imageUrl = typeof part.image_url === 'string'
      ? part.image_url
      : typeof part.image_url?.url === 'string'
        ? part.image_url.url
        : null;
    return parseImageDataUri(imageUrl) !== null;
  });
}

function joinTextParts(parts: Array<{ text?: string } | string>): string {
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      return typeof part?.text === 'string' ? part.text : '';
    })
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function extractReasoningText(payload: PersistedReasoningPayload | PersistedEventPayload): string {
  if ('summary' in payload && Array.isArray(payload.summary) && payload.summary.length > 0) {
    return joinTextParts(payload.summary);
  }

  if ('content' in payload && Array.isArray(payload.content) && payload.content.length > 0) {
    return joinTextParts(payload.content);
  }

  return typeof payload.text === 'string' ? payload.text.trim() : '';
}

// ---------------------------------------------------------------------------
// Legacy event wrapper processing (kept as-is)
// ---------------------------------------------------------------------------

function processLegacyItem(
  eventType: string,
  item: CodexItem,
  turn: TurnAccumulator,
): void {
  switch (item.type) {
    case 'agent_message':
      if (eventType === 'item.completed' || eventType === 'item.updated') {
        if (item.text) {
          const visibleText = stripCodexMemoryCitationMarkup(item.text);
          turn.assistantText = visibleText;
          setTextBlock(turn, visibleText);
        }
      }
      break;

    case 'reasoning':
      if (eventType === 'item.completed' || eventType === 'item.updated') {
        if (item.text) {
          setThinkingBlock(turn, item.text);
        }
      }
      break;

    case 'command_execution': {
      const presentation = presentCodexCommand({
        command: item.command,
        cwd: item.cwd,
        commandActions: item.commandActions,
      });
      if (eventType === 'item.started') {
        turn.toolCalls.push({
          id: item.id,
          name: normalizeCodexToolName(item.type),
          input: normalizeCodexToolInput(item.type, { command: item.command ?? '' }),
          ...(presentation ? { presentation } : {}),
          status: 'running',
        });
        turn.contentBlocks.push({ type: 'tool_use', toolId: item.id });
      } else if (eventType === 'item.completed') {
        const tc = turn.toolCalls.find(tool => tool.id === item.id);
        if (tc) {
          if (presentation) tc.presentation = presentation;
          const rawOutput = item.aggregated_output ?? '';
          tc.result = normalizeCodexToolResult(tc.name, rawOutput);
          tc.status = item.exit_code === 0 ? 'completed' : 'error';
          if (typeof item.exit_code === 'number') tc.exitCode = item.exit_code;
        }
      }
      break;
    }

    case 'file_change': {
      const changes = item.changes ?? [];
      if (eventType === 'item.started' || eventType === 'item.completed') {
        const existing = turn.toolCalls.find(tool => tool.id === item.id);
        if (!existing) {
          const paths = changes.map(change => `${change.kind}: ${change.path}`).join(', ');
          turn.toolCalls.push({
            id: item.id,
            name: normalizeCodexToolName('file_change'),
            input: { changes },
            presentation: presentCodexFileChange(changes, item.cwd),
            status: item.status === 'completed' ? 'completed' : 'error',
            result: paths ? `Applied: ${paths}` : 'Applied',
          });
          turn.contentBlocks.push({ type: 'tool_use', toolId: item.id });
        } else if (eventType === 'item.completed') {
          existing.presentation = presentCodexFileChange(changes, item.cwd);
          existing.status = item.status === 'completed' ? 'completed' : 'error';
        }
      }
      break;
    }

    case 'web_search':
      if (eventType === 'item.started') {
        turn.toolCalls.push({
          id: item.id,
          name: normalizeCodexToolName(item.type),
          input: normalizeCodexToolInput(item.type, { query: item.query ?? '' }),
          status: 'running',
        });
        turn.contentBlocks.push({ type: 'tool_use', toolId: item.id });
      } else if (eventType === 'item.completed') {
        const tc = turn.toolCalls.find(tool => tool.id === item.id);
        if (tc) {
          tc.result = 'Search complete';
          tc.status = 'completed';
        }
      }
      break;

    case 'mcp_tool_call':
      if (eventType === 'item.started') {
        const server = item.server ?? '';
        const tool = item.tool ?? '';
        turn.toolCalls.push({
          id: item.id,
          name: `mcp__${server}__${tool}`,
          input: normalizeCodexMcpToolInput(item.arguments),
          presentation: presentCodexMcpToolCall(server, tool),
          status: 'running',
        });
        turn.contentBlocks.push({ type: 'tool_use', toolId: item.id });
      } else if (eventType === 'item.completed') {
        const tc = turn.toolCalls.find(tool => tool.id === item.id);
        if (tc) {
          const completion = normalizeCodexMcpToolCompletion(item.status, item.result, item.error);
          tc.status = completion.isError ? 'error' : 'completed';
          tc.result = completion.result;
        }
      }
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Persisted-format (response_item) processing — with bubble model
// ---------------------------------------------------------------------------

interface PersistedParseContext {
  turns: Map<string, CodexTurnState>;
  turnOrder: string[];
  currentTurnId: string | null;
  toolCallToTurn: Map<string, { turnId: string; bubbleIndex: number }>;
  suppressedToolOutputIds: Set<string>;
  terminalSessionToCommandId: Map<string, string>;
  pendingStdinCalls: Map<string, { parentCallId?: string }>;
  execCellToCommandId: Map<string, string>;
  execEnvelopeToolCallIds: Map<string, string[]>;
  imageViewEnvelopeToolCallIds: Map<string, string[]>;
  execEnvelopeInternalOutputCallIds: Set<string>;
  nativeCommandResultCallIds: Set<string>;
  nativeWebSearchResultCallIds: Set<string>;
  nativeImageResultCallIds: Set<string>;
  completedExecCallIds: Set<string>;
  imageCallCandidates: Map<string, { name: string; input: Record<string, unknown> }>;
  observedNativeItemIds: Set<string>;
  nativeMessageCitations: Map<string, CitationGroup>;
  nativeCallCandidates: Array<{
    toolCallId?: string;
    opaqueCallId?: string;
    request: { name: string; input: Record<string, unknown> } | null;
  }>;
  workingDirectory?: string;
  withheldExecCellIds: Set<string>;
  withheldOutputCallIds: Set<string>;
  failedExecCallIds: Set<string>;
  waitCallToCommand: Map<string, { commandCallId: string; cellId: string }>;
  turnCounter: number;
}

function nextTurnId(ctx: PersistedParseContext): string {
  ctx.turnCounter += 1;
  return `turn-${ctx.turnCounter}`;
}

function processPersistedToolCall(
  payload: PersistedToolCallPayload,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  const callId = payload.call_id;
  if (!callId) return;

  if (isCodexInternalToolCall(payload.name, payload.namespace)) {
    ctx.suppressedToolOutputIds.add(callId);
    return;
  }

  const rawArgs = payload.arguments ?? payload.input;
  const parsedArgs = parseCodexArguments(rawArgs);
  if (payload.name === 'wait') {
    const cellId = readCodexExecCellIdArgument(parsedArgs);
    if (cellId && ctx.withheldExecCellIds.delete(cellId)) {
      ctx.withheldOutputCallIds.add(callId);
      ctx.suppressedToolOutputIds.add(callId);
      return;
    }
  }
  // A failed script can stop before later calls or emit partial results. Its
  // source and output do not establish which nested tools actually executed.
  if (payload.name === 'exec' && ctx.failedExecCallIds.has(callId)) {
    ctx.nativeCallCandidates.push({ opaqueCallId: callId, request: null });
    pushPersistedNormalizedToolCall(callId, { name: 'exec', input: parsedArgs }, timestamp, ctx);
    return;
  }
  const execEnvelopeCalls = payload.name === 'exec'
    ? decodeCodexExecEnvelopeCalls(parsedArgs)
    : null;
  const internalExecCalls = execEnvelopeCalls?.filter(call =>
    isCodexInternalToolCall(call.rawName),
  ) ?? [];
  if (internalExecCalls.length > 0 && internalExecCalls.length === execEnvelopeCalls?.length) {
    ctx.withheldOutputCallIds.add(callId);
    return;
  }
  const normalized = normalizeCodexToolCall(payload.name, parsedArgs);
  if (payload.name === 'exec' && !execEnvelopeCalls) ctx.nativeCallCandidates.push({ opaqueCallId: callId, request: null });
  const candidates = execEnvelopeCalls?.map(call => call.rawName === 'web__run'
    ? { ...call, name: 'WebSearch', input: normalizeCodexToolInput('web_search', call.rawInput) }
    : call) ?? [{ ...normalized, rawInput: parsedArgs, rawName: payload.name }];
  candidates.forEach(({ name, input, rawInput, rawName }, index) => {
    const toolCallId = execEnvelopeCalls && execEnvelopeCalls.length > 1 ? `${callId}:${index + 1}` : callId;
    if (rawName === 'view_image' || rawName === 'image_gen__imagegen') {
      ctx.imageCallCandidates.set(toolCallId, { name: rawName, input });
    }
    if (name !== 'Bash' && name !== 'WebSearch' && !name.startsWith('mcp__')) return;
    if (name === 'Bash') {
      const directory = rawInput.workdir ?? rawInput.cwd ?? rawInput.workingDirectory;
      const workingDirectory = resolvePersistedWorkingDirectory(directory, ctx.workingDirectory);
      ctx.nativeCallCandidates.push(workingDirectory === null ? { request: null } : {
        toolCallId, request: { name, input: { ...input, workingDirectory } },
      });
    } else {
      ctx.nativeCallCandidates.push({ toolCallId, request: { name, input } });
    }
  });
  if (internalExecCalls.length > 0 && execEnvelopeCalls) {
    const toolCallIds = execEnvelopeCalls.map((call, index) => {
      const nestedCallId = `${callId}:${index + 1}`;
      if (call.name === 'write_stdin' && isSilentWriteStdinInput(call.input)) return nestedCallId;
      if (isCodexInternalToolCall(call.rawName)) {
        ctx.suppressedToolOutputIds.add(nestedCallId);
      } else {
        processPersistedNormalizedToolCall(
          nestedCallId,
          call,
          timestamp,
          ctx,
          call.rawInput.workdir ?? call.rawInput.cwd ?? call.rawInput.workingDirectory,
        );
      }
      return nestedCallId;
    });
    ctx.execEnvelopeToolCallIds.set(callId, toolCallIds);
    ctx.execEnvelopeInternalOutputCallIds.add(callId);
    return;
  }
  if (execEnvelopeCalls && execEnvelopeCalls.length > 1) {
    const toolCallIds = execEnvelopeCalls.map((call, index) => {
      const nestedCallId = `${callId}:${index + 1}`;
      if (call.name === 'write_stdin' && isSilentWriteStdinInput(call.input)) return nestedCallId;
      processPersistedNormalizedToolCall(
        nestedCallId,
        call,
        timestamp,
        ctx,
        call.rawInput.workdir ?? call.rawInput.cwd ?? call.rawInput.workingDirectory,
      );
      return nestedCallId;
    });
    ctx.execEnvelopeToolCallIds.set(callId, toolCallIds);
    pushPersistedNormalizedToolCall(callId, { name: 'exec', input: parsedArgs }, timestamp, ctx);
    if (execEnvelopeCalls.every(call => call.rawName === 'view_image')) {
      ctx.imageViewEnvelopeToolCallIds.set(callId, toolCallIds);
    }
    return;
  }

  if (execEnvelopeCalls?.[0]?.rawName === 'web__run') {
    processPersistedNormalizedToolCall(callId, {
      name: 'WebSearch',
      input: normalizeCodexToolInput('web_search', execEnvelopeCalls[0].rawInput),
    }, timestamp, ctx);
    return;
  }

  processPersistedNormalizedToolCall(
    callId,
    normalizeCodexToolCall(payload.name, parsedArgs),
    timestamp,
    ctx,
    execEnvelopeCalls?.[0]?.rawInput.workdir
      ?? execEnvelopeCalls?.[0]?.rawInput.cwd
      ?? execEnvelopeCalls?.[0]?.rawInput.workingDirectory
      ?? parsedArgs.workdir
      ?? parsedArgs.cwd
      ?? parsedArgs.workingDirectory,
  );
}

function processPersistedNormalizedToolCall(
  callId: string,
  normalized: NormalizedCodexToolCall,
  timestamp: number,
  ctx: PersistedParseContext,
  cwd?: unknown,
): void {
  if (normalized.name === 'wait') {
    const cellId = readCodexExecCellIdArgument(normalized.input);
    const commandCallId = cellId ? ctx.execCellToCommandId.get(cellId) : undefined;
    if (cellId && commandCallId) {
      ctx.waitCallToCommand.set(callId, { commandCallId, cellId });
      return;
    }
  }

  if (normalized.name === 'write_stdin' && isSilentWriteStdinInput(normalized.input)) {
    const terminalSessionId = readTerminalSessionIdArgument(normalized.input);
    const parentCallId = terminalSessionId ? ctx.terminalSessionToCommandId.get(terminalSessionId) : undefined;
    ctx.pendingStdinCalls.set(callId, { parentCallId });
    if (parentCallId) return;
    // An unowned poll may be the only surviving copy of a command's failure.
  }

  const presentation = normalized.presentation ?? (normalized.name === 'Bash'
    ? presentCodexCommand({
      command: normalized.input.command,
      cwd: cwd ?? ctx.workingDirectory,
    })
    : undefined);
  pushPersistedNormalizedToolCall(callId, normalized, timestamp, ctx, presentation);
}

function pushPersistedNormalizedToolCall(
  callId: string,
  normalized: { name: string; input: Record<string, unknown> },
  timestamp: number,
  ctx: PersistedParseContext,
  presentation?: ToolCallInfo['presentation'],
): void {
  const turn = ensureTurn(
    ctx.turns,
    ctx.turnOrder,
    nextTurnId(ctx),
    ctx.currentTurnId,
    timestamp,
  );
  const bubble = ensureAssistantBubble(turn, timestamp);

  const toolCall: ToolCallInfo = {
    id: callId,
    name: normalized.name,
    input: normalized.input,
    ...(presentation ? { presentation } : {}),
    status: 'running',
  };

  pushToolInvocation(bubble, toolCall);

  ctx.toolCallToTurn.set(callId, {
    turnId: turn.id,
    bubbleIndex: turn.activeBubbleIndex!,
  });
}

function processPersistedToolOutput(
  payload: PersistedToolCallOutputPayload,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  const callId = payload.call_id;
  if (!callId) return;

  // output can be a string or an array (e.g. view_image returns image objects)
  const rawOutput = stringifyCodexToolOutput(payload.output);

  if (ctx.withheldOutputCallIds.delete(callId)) {
    const cellId = extractCodexExecCellId(rawOutput);
    if (cellId) ctx.withheldExecCellIds.add(cellId);
    ctx.suppressedToolOutputIds.delete(callId);
    return;
  }

  const execEnvelopeToolCallIds = ctx.execEnvelopeToolCallIds.get(callId);
  if (execEnvelopeToolCallIds) {
    const withholdsOutput = ctx.execEnvelopeInternalOutputCallIds.delete(callId);
    if (withholdsOutput) {
      const cellId = extractCodexExecCellId(rawOutput);
      if (cellId) ctx.withheldExecCellIds.add(cellId);
    }
    applyPersistedExecEnvelopeOutput(
      callId,
      execEnvelopeToolCallIds,
      payload.output,
      rawOutput,
      ctx,
      withholdsOutput,
    );
    ctx.execEnvelopeToolCallIds.delete(callId);
    return;
  }

  const waitCall = ctx.waitCallToCommand.get(callId);
  if (waitCall) {
    const parentToolCall = findPersistedToolCallById(ctx, waitCall.commandCallId);
    ctx.execCellToCommandId.delete(waitCall.cellId);
    if (parentToolCall) {
      applyPersistedToolOutput(parentToolCall, payload.output, rawOutput, ctx);
    }
    ctx.waitCallToCommand.delete(callId);
    return;
  }

  const pendingStdinCall = ctx.pendingStdinCalls.get(callId);
  if (pendingStdinCall) {
    ctx.pendingStdinCalls.delete(callId);
    if (pendingStdinCall.parentCallId) {
      const parentToolCall = findPersistedToolCallById(ctx, pendingStdinCall.parentCallId);
      if (parentToolCall) {
        applyPersistedToolOutput(parentToolCall, payload.output, rawOutput, ctx, {
          allowImplicitCommandCompletion: false,
        });
      }
      return;
    }
    const acknowledgement = normalizeCodexToolResult('exec', rawOutput).trim();
    if (!extractCodexExecCellId(rawOutput) && (!acknowledgement || acknowledgement === 'Input sent.')) {
      removePersistedToolCall(ctx, callId);
      return;
    }
  }

  if (ctx.suppressedToolOutputIds.delete(callId)) {
    return;
  }

  // Cross-turn resolution: look up where the tool call was originally pushed
  const origin = ctx.toolCallToTurn.get(callId);
  if (origin) {
    const originTurn = ctx.turns.get(origin.turnId);
    if (originTurn && origin.bubbleIndex < originTurn.assistantBubbles.length) {
      const originBubble = originTurn.assistantBubbles[origin.bubbleIndex];
      const existing = originBubble.toolCalls.find(tool => tool.id === callId);
      if (existing) {
        if (ctx.nativeWebSearchResultCallIds.has(callId)) {
          existing.status = isCodexToolOutputError(rawOutput)
            ? 'error'
            : 'completed';
          return;
        }
        applyPersistedToolOutput(existing, payload.output, rawOutput, ctx);
        return;
      }
    }
  }

  if (payload.type === 'custom_tool_call_output') {
    return;
  }

  // Fallback: push orphan entry into current turn
  const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
  const bubble = ensureAssistantBubble(turn, timestamp);
  const normalizedResult = normalizeCodexToolResult('tool', rawOutput);

  pushToolInvocation(bubble, {
    id: callId,
    name: 'tool',
    input: {},
    status: isCodexToolOutputError(rawOutput) ? 'error' : 'completed',
    result: normalizedResult,
  });
}

function findPersistedToolCallById(ctx: PersistedParseContext, callId: string): ToolCallInfo | null {
  const origin = ctx.toolCallToTurn.get(callId);
  if (!origin) {
    return null;
  }

  const turn = ctx.turns.get(origin.turnId);
  if (!turn || origin.bubbleIndex >= turn.assistantBubbles.length) {
    return null;
  }

  return turn.assistantBubbles[origin.bubbleIndex].toolCalls.find(tool => tool.id === callId) ?? null;
}

function applyPersistedQuestionReplies(text: string, ctx: PersistedParseContext): boolean {
  const replies = parseCodexQuestionReply(text);
  for (const reply of replies) {
    const tool = findPersistedToolCallById(ctx, reply.callId);
    const questions: unknown = tool?.input.questions;
    const question: unknown = Array.isArray(questions) ? questions[reply.index] : undefined;
    if (tool?.input.replyMode !== 'user-message'
      || !question || typeof question !== 'object' || Array.isArray(question)) continue;
    const item = question as Record<string, unknown>;
    if (item.question !== reply.question) continue;
    const answerKey = typeof item.id === 'string' ? item.id : String(reply.index);
    tool.resolvedAnswers = { ...tool.resolvedAnswers, [answerKey]: reply.answer };
  }
  return replies.length > 0;
}

function removePersistedToolCall(ctx: PersistedParseContext, callId: string): void {
  const origin = ctx.toolCallToTurn.get(callId);
  if (!origin) return;
  const bubble = ctx.turns.get(origin.turnId)?.assistantBubbles[origin.bubbleIndex];
  if (!bubble) return;
  bubble.toolCalls = bubble.toolCalls.filter(tool => tool.id !== callId);
  bubble.contentBlocks = bubble.contentBlocks.filter(block => block.type !== 'tool_use' || block.toolId !== callId);
  bubble.toolIndexesById.clear();
  bubble.toolCalls.forEach((tool, index) => bubble.toolIndexesById.set(tool.id, index));
  ctx.toolCallToTurn.delete(callId);
}

function applyPersistedExecEnvelopeOutput(
  envelopeCallId: string,
  toolCallIds: string[],
  rawOutputValue: string | unknown[] | undefined,
  rawOutputText: string,
  ctx: PersistedParseContext,
  withholdsOutput: boolean,
): void {
  // Script emission order does not establish individual tool-result ownership.
  const isError = isCodexToolOutputError(rawOutputText);
  for (const callId of toolCallIds) {
    const toolCall = findPersistedToolCallById(ctx, callId);
    if (toolCall?.status === 'running') toolCall.status = isError ? 'error' : 'completed';
  }
  const envelope = findPersistedToolCallById(ctx, envelopeCallId);
  if (envelope && !withholdsOutput) {
    applyPersistedToolOutput(envelope, rawOutputValue, rawOutputText, ctx);
  }
}

function readTerminalSessionIdArgument(input: Record<string, unknown>): string | undefined {
  const value = input.session_id ?? input.sessionId;
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function deduplicatePersistedImageViewPreviews(ctx: PersistedParseContext): void {
  if (ctx.imageViewEnvelopeToolCallIds.size === 0) return;
  const tools = [...ctx.turns.values()].flatMap(turn => turn.assistantBubbles.flatMap(bubble => bubble.toolCalls));
  const toolsById = new Map(tools.map(tool => [tool.id, tool]));
  const generatedImages = new Map<string, ToolResultImage | null>();
  for (const tool of tools) {
    const image = tool.resultImages?.[0];
    if (tool.name !== 'image_gen__imagegen' || tool.status !== 'completed' || !tool.result
      || !ctx.nativeImageResultCallIds.has(tool.id) || image?.kind !== 'data') continue;
    generatedImages.set(tool.result, generatedImages.has(tool.result) ? null : image);
  }
  for (const [envelopeId, childIds] of ctx.imageViewEnvelopeToolCallIds) {
    const envelope = toolsById.get(envelopeId);
    if (envelope?.status !== 'completed' || !envelope.resultImages?.length) continue;
    const previews = childIds.flatMap(id => {
      const tool = toolsById.get(id);
      if (!tool || tool.status !== 'completed' || !ctx.nativeImageResultCallIds.has(id)) return [];
      const preview = tool.resultImages?.[0];
      const image = preview?.kind === 'file' ? generatedImages.get(preview.path) : preview;
      return image?.kind === 'data' ? [{ tool, image }] : [];
    });
    const remaining: ToolResultImage[] = [];
    for (const image of envelope.resultImages) {
      const index = previews.findIndex(({ image: preview }) => image.kind === 'data'
        && preview.mediaType === image.mediaType && preview.data === image.data);
      if (index < 0) remaining.push(image);
      else {
        const [{ tool }] = previews.splice(index, 1);
        tool.resultImages = [image];
      }
    }
    envelope.resultImages = remaining.length > 0 ? remaining : undefined;
    if (remaining.length === 0 && !envelope.result?.trim()) removePersistedToolCall(ctx, envelopeId);
  }
}

function removeImageGenerationHints(output: string, hints: ReadonlySet<string>): string | undefined {
  if (hints.has(output.trim())) return '';

  let value: unknown;
  try { value = JSON.parse(output); } catch { return undefined; }
  if (typeof value === 'string') return hints.has(value) ? '' : undefined;
  if (!value || typeof value !== 'object') return undefined;

  // Only rewrite collections whose JSON round-trip preserves the original
  // representation, including every independent value.
  if (JSON.stringify(value) !== output.trim()) return undefined;
  const entries: [string, unknown][] = Object.entries(value);
  const remaining = entries.filter(([, entry]) => typeof entry !== 'string' || !hints.has(entry));
  if (remaining.length === entries.length) return undefined;
  if (remaining.length === 0) return '';
  return JSON.stringify(Array.isArray(value) ? remaining.map(([, entry]) => entry) : Object.fromEntries(remaining));
}

function deduplicatePersistedImageGenerationHints(ctx: PersistedParseContext): void {
  if (ctx.completedExecCallIds.size === 0 || ctx.nativeImageResultCallIds.size === 0) return;
  for (const turn of ctx.turns.values()) {
    for (const bubble of turn.assistantBubbles) {
      const hints = new Set<string>();
      for (const tool of bubble.toolCalls) {
        const imagePath = tool.result;
        if (tool.name !== 'image_gen__imagegen' || tool.status !== 'completed'
          || !imagePath || !tool.resultImages?.length || !ctx.nativeImageResultCallIds.has(tool.id)) continue;
        const directory = path.isAbsolute(imagePath) ? path.dirname(imagePath) : path.win32.dirname(imagePath);
        // Match the complete provider output hint, including its saved image path.
        hints.add([
          `Generated images are saved to ${directory} as ${imagePath} by default.`,
          'If you need to use a generated image at another path, copy it and leave the original in place unless the user explicitly asks you to delete it.',
          'The generated image is already displayed to the user. There is no need to render it in the final response as a Markdown image or file link.',
        ].join('\n'));
      }
      if (hints.size === 0) continue;
      for (const script of bubble.toolCalls) {
        if (script.name !== 'exec' || script.status !== 'completed' || !script.result
          || !ctx.completedExecCallIds.has(script.id)) continue;
        const remaining = removeImageGenerationHints(script.result, hints);
        if (remaining === undefined) continue;
        if (!remaining && !script.resultImages?.length) {
          removePersistedToolCall(ctx, script.id);
        } else {
          script.result = remaining;
          script.presentation = { name: 'Script output', countsAsActivity: false };
        }
      }
    }
  }
}

function isSilentWriteStdinInput(input: Record<string, unknown>): boolean {
  return typeof input.chars !== 'string' || input.chars.length === 0;
}

function readPersistedCommandToolResult(rawOutputText: string): {
  output: string;
  status: 'running' | 'completed' | 'unknown';
  exitCode?: number;
  terminalSessionId?: string;
  execCellId?: string;
} {
  // Code-mode adds a script header before the command's JSON result.
  const outputMarker = 'Output:\n';
  const markerIndex = rawOutputText.startsWith('Script ') ? rawOutputText.indexOf(outputMarker) : -1;
  let commandResultText = markerIndex >= 0
    ? rawOutputText.slice(markerIndex + outputMarker.length)
    : rawOutputText;
  let metadata = parseCodexArguments(commandResultText);
  // Promise.allSettled results retain the command metadata under value.
  if (metadata.status === 'fulfilled' && metadata.value && typeof metadata.value === 'object'
    && !Array.isArray(metadata.value) && typeof (metadata.value as Record<string, unknown>).output === 'string') {
    metadata = metadata.value as Record<string, unknown>;
    commandResultText = JSON.stringify(metadata);
  }
  const exitCodeMatch = commandResultText.match(/(?:Exit code:|Process exited with code)\s*(-?\d+)/i);
  const exitCode = typeof metadata.exit_code === 'number' && Number.isInteger(metadata.exit_code)
    ? metadata.exit_code
    : exitCodeMatch ? Number(exitCodeMatch[1]) : undefined;
  const runningMatch = commandResultText.match(/Process running with session ID\s*([^\n]+)/i);
  const terminalSessionId = readTerminalSessionIdArgument(metadata) || runningMatch?.[1]?.trim();
  const execCellId = extractCodexExecCellId(rawOutputText);

  return {
    output: normalizeCodexToolResult('Bash', commandResultText),
    status: exitCode !== undefined ? 'completed' : terminalSessionId || execCellId ? 'running' : 'unknown',
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(terminalSessionId ? { terminalSessionId } : {}),
    ...(execCellId ? { execCellId } : {}),
  };
}

function applyPersistedToolOutput(
  toolCall: ToolCallInfo,
  rawOutputValue: string | unknown[] | undefined,
  rawOutputText: string,
  ctx: PersistedParseContext,
  options: { allowImplicitCommandCompletion?: boolean } = {},
): void {
  const nativeImageResult = ctx.nativeImageResultCallIds.has(toolCall.id);
  const isImageView = ctx.imageCallCandidates.get(toolCall.id)?.name === 'view_image'
    || (nativeImageResult && toolCall.name === 'Read');
  if (isImageView && toolCall.status !== 'error' && toolCall.status !== 'cancelled' && Array.isArray(rawOutputValue)) {
    const images = extractMessageImages(rawOutputValue as PersistedMessagePart[], toolCall.id)
      .map(({ data, mediaType }) => ({ kind: 'data' as const, data, mediaType }));
    if (images.length > 0) toolCall.resultImages = images;
  }
  if (nativeImageResult) return;
  if (toolCall.name === 'exec') {
    toolCall.result = appendCodexCommandOutput(toolCall.result, normalizeCodexToolResult('exec', rawOutputText));
    if (Array.isArray(rawOutputValue)) {
      const images = extractMessageImages(rawOutputValue as PersistedMessagePart[], toolCall.id)
        .map(({ data, mediaType }) => ({ kind: 'data' as const, data, mediaType }));
      if (images.length > 0) toolCall.resultImages = [...(toolCall.resultImages ?? []), ...images];
    }
    const cellId = extractCodexExecCellId(rawOutputText);
    if (cellId) ctx.execCellToCommandId.set(cellId, toolCall.id);
    if (!cellId && /^Script (?:completed|error:|failed)(?:\r?\n|$)/.test(rawOutputText)
      && !/Process running with session ID/i.test(rawOutputText)) {
      ctx.nativeCallCandidates = ctx.nativeCallCandidates.filter(call => call.opaqueCallId !== toolCall.id);
    }
    toolCall.status = cellId ? 'running'
      : ctx.failedExecCallIds.has(toolCall.id) || isCodexToolOutputError(rawOutputText) ? 'error' : 'completed';
    if (toolCall.status === 'completed' && /^Script completed(?:\r?\n|$)/.test(rawOutputText)) {
      ctx.completedExecCallIds.add(toolCall.id);
    } else {
      ctx.completedExecCallIds.delete(toolCall.id);
    }
    return;
  }

  if (toolCall.name === 'Bash' || toolCall.name === 'write_stdin') {
    if (ctx.nativeCommandResultCallIds.has(toolCall.id)) return;
    const commandResult = readPersistedCommandToolResult(rawOutputText);
    toolCall.result = appendCodexCommandOutput(toolCall.result, commandResult.output);
    if (commandResult.terminalSessionId && toolCall.name === 'Bash') {
      ctx.terminalSessionToCommandId.set(commandResult.terminalSessionId, toolCall.id);
    }
    if (commandResult.execCellId) {
      ctx.execCellToCommandId.set(commandResult.execCellId, toolCall.id);
    }
    if (commandResult.execCellId || (commandResult.status === 'running' && toolCall.name === 'Bash')) {
      toolCall.status = 'running';
      return;
    }
    if (commandResult.status === 'unknown' && options.allowImplicitCommandCompletion === false) {
      return;
    }
    toolCall.status = commandResult.exitCode !== undefined
      ? commandResult.exitCode === 0 ? 'completed' : 'error'
      : isCodexToolOutputError(rawOutputText) || isCodexToolOutputError(commandResult.output) ? 'error' : 'completed';
    if (commandResult.exitCode !== undefined) toolCall.exitCode = commandResult.exitCode;
    return;
  }

  toolCall.result = normalizePersistedToolOutput(toolCall, rawOutputValue, rawOutputText);
  toolCall.status = (toolCall.name === 'exec' && ctx.failedExecCallIds.has(toolCall.id))
    || isCodexToolOutputError(rawOutputText) ? 'error' : 'completed';
}

function normalizePersistedToolOutput(
  toolCall: ToolCallInfo,
  rawOutputValue: string | unknown[] | undefined,
  rawOutputText: string,
): string {
  if (Array.isArray(rawOutputValue) && toolCall.name === 'Read') {
    const filePath = toolCall.input.file_path;
    if (typeof filePath === 'string' && filePath) {
      return filePath;
    }
  }

  return normalizeCodexToolResult(toolCall.name, rawOutputText);
}

function processPersistedWebSearchCall(
  payload: PersistedWebSearchCallPayload,
  timestamp: number,
  lineIndex: number,
  ctx: PersistedParseContext,
): void {
  const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
  const bubble = ensureAssistantBubble(turn, timestamp);

  // Persisted web_search_call entries commonly omit call_id. Use transcript line index
  // so live tailing and history reload reconstruct the same visible tool sequence.
  const callId = payload.call_id || `tail-ws-${lineIndex}`;

  if (bubble.toolIndexesById.has(callId)) return;

  const input = normalizeCodexToolInput('web_search_call', {
    action: payload.action ?? {},
  });

  const isTerminal = payload.status === 'completed' || payload.status === 'failed'
    || payload.status === 'error' || payload.status === 'cancelled';

  const toolCall: ToolCallInfo = {
    id: callId,
    name: 'WebSearch',
    input,
    status: isTerminal ? (payload.status === 'completed' ? 'completed' : 'error') : 'running',
    ...(isTerminal ? { result: 'Search complete' } : {}),
  };

  pushToolInvocation(bubble, toolCall);

  ctx.toolCallToTurn.set(callId, {
    turnId: turn.id,
    bubbleIndex: turn.assistantBubbles.indexOf(bubble),
  });
}

function processPersistedMcpToolCall(
  payload: PersistedMcpToolCallPayload,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  const callId = payload.call_id;
  if (!callId) return;

  const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
  const bubble = ensureAssistantBubble(turn, timestamp);

  if (bubble.toolIndexesById.has(callId)) return;

  const normalizedInput = normalizeCodexMcpToolInput(payload.arguments);
  const normalizedState = normalizeCodexMcpToolState(payload.status, payload.result, payload.error);

  const toolCall: ToolCallInfo = {
    id: callId,
    name: normalizeCodexMcpToolName(payload.server, payload.tool),
    input: normalizedInput,
    presentation: presentCodexMcpToolCall(payload.server, payload.tool),
    status: normalizedState.status,
    ...(normalizedState.result ? { result: normalizedState.result } : {}),
  };

  pushToolInvocation(bubble, toolCall);

  ctx.toolCallToTurn.set(callId, {
    turnId: turn.id,
    bubbleIndex: turn.activeBubbleIndex!,
  });
}

function processPersistedPayload(
  payload: PersistedPayload,
  timestamp: number,
  lineIndex: number,
  ctx: PersistedParseContext,
): void {
  if (!payload?.type) {
    return;
  }

  switch (payload.type) {
    case 'message': {
      const messagePayload = payload as PersistedMessagePayload;

      if (messagePayload.role === 'user') {
        const text = extractUserMessageText(messagePayload.content);
        const isQuestionReply = applyPersistedQuestionReplies(text, ctx);
        const visibleText = extractCodexUserVisibleText(text);
        const hasImages = hasMessageImages(messagePayload.content);
        if (visibleText === null && !hasImages && !isQuestionReply) break;
        ctx.imageCallCandidates.clear();

        // Close any active bubble in the current turn before starting user content
        if (ctx.currentTurnId) {
          const prevTurn = ctx.turns.get(ctx.currentTurnId);
          if (prevTurn) closeAssistantBubble(prevTurn);
        }

        // User message opens a new turn
        ctx.currentTurnId = null;
        const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), null, timestamp);
        ctx.currentTurnId = turn.id;
        if (isQuestionReply || visibleText !== null) {
          appendUserChunk(turn, isQuestionReply ? text : visibleText!, timestamp);
        }
        appendUserImages(turn, messagePayload.content, timestamp);
      } else if (messagePayload.role === 'assistant') {
        const text = stripCodexMemoryCitationMarkup(
          extractMessageText(messagePayload.content),
        );
        const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
        const bubble = ensureAssistantBubble(turn, timestamp);
        if (text) {
          appendPersistedAssistantText(bubble, text);
        }
        if (typeof messagePayload.id === 'string') {
          appendCitationBlock(bubble, ctx.nativeMessageCitations.get(messagePayload.id));
        }
      }
      break;
    }

    case 'reasoning': {
      const reasoningPayload = payload as PersistedReasoningPayload;
      const text = extractReasoningText(reasoningPayload);
      if (!text) break;

      const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
      const bubble = ensureAssistantBubble(turn, timestamp);
      appendOrderedTextChunk(bubble, 'thinking', text);
      break;
    }

    case 'function_call':
    case 'custom_tool_call':
      processPersistedToolCall(payload as PersistedToolCallPayload, timestamp, ctx);
      break;

    case 'function_call_output':
    case 'custom_tool_call_output':
      processPersistedToolOutput(payload as PersistedToolCallOutputPayload, timestamp, ctx);
      break;

    case 'web_search_call':
      processPersistedWebSearchCall(payload as PersistedWebSearchCallPayload, timestamp, lineIndex, ctx);
      break;

    case 'mcp_tool_call':
      processPersistedMcpToolCall(payload as PersistedMcpToolCallPayload, timestamp, ctx);
      break;

    case 'compaction':
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// event_msg processing
// ---------------------------------------------------------------------------

function extractServerTurnId(payload: PersistedEventPayload): string | undefined {
  const turnId = (payload as Record<string, unknown>).turn_id;
  return typeof turnId === 'string' ? turnId : undefined;
}

function resolvePersistedWorkingDirectory(directory: unknown, baseDirectory?: string): string | null | undefined {
  try {
    if (typeof directory !== 'string' || !directory) return baseDirectory && path.resolve(baseDirectory);
    return path.resolve(baseDirectory ?? '', directory.startsWith('file:') ? fileURLToPath(directory) : directory);
  } catch {
    return null;
  }
}

function claimPersistedNativeCall(
  name: string,
  nativeInputs: Record<string, unknown>[],
  ctx: PersistedParseContext,
): ToolCallInfo | null {
  const matches = ctx.nativeCallCandidates.filter(({ request }) => !request || (codexScriptToolNamesMatch(request.name, name)
    && nativeInputs.some(input => codexToolRequestsMatch(name, request.input, input))));
  if (matches.length !== 1 || !matches[0].request) return null;
  const [call] = matches;
  const tool = call.toolCallId ? findPersistedToolCallById(ctx, call.toolCallId) : null;
  // A loop may emit a command repeatedly; keep its request as ambiguity evidence.
  if (name === 'Bash') call.toolCallId = undefined;
  else ctx.nativeCallCandidates.splice(ctx.nativeCallCandidates.indexOf(call), 1);
  return tool;
}

function readPersistedCommandExploration(actions: readonly unknown[]): ToolCallInfo['exploration'] {
  if (!actions.length) return undefined;
  let reads = 0;
  let searches = 0;
  const details: ToolExplorationAction[] = [];
  for (const action of actions) {
    if (!action || typeof action !== 'object' || !('type' in action)) return undefined;
    const path = 'path' in action && typeof action.path === 'string' && action.path.trim() ? action.path : undefined;
    if (action.type === 'read') {
      reads++;
      if (path) details.push({ type: 'read', path });
    } else if (action.type === 'search') {
      searches++;
      const query = 'query' in action && typeof action.query === 'string' && action.query.trim() ? action.query : undefined;
      if (query || path) details.push({ type: 'search', ...(query ? { query } : {}), ...(path ? { path } : {}) });
    } else {
      return undefined;
    }
  }
  return { reads, searches, ...(details.length ? { actions: details } : {}) };
}

function applyPersistedNativeCommandItem(item: Record<string, unknown> | undefined, ctx: PersistedParseContext): void {
  if (!item || !['CommandExecution', 'commandExecution', 'command_execution'].includes(String(item.type))) return;
  const itemId = typeof item.id === 'string' ? item.id : undefined;
  if (itemId && ctx.observedNativeItemIds.has(itemId)) return;
  if (itemId) ctx.observedNativeItemIds.add(itemId);
  const actions: unknown[] = Array.isArray(item.parsed_cmd) ? item.parsed_cmd : [];
  const parsedCommandItem = actions[0];
  const parsedCommand = parsedCommandItem && typeof parsedCommandItem === 'object' && !Array.isArray(parsedCommandItem)
    ? (parsedCommandItem as Record<string, unknown>).cmd : undefined;
  const commands = [parsedCommand, Array.isArray(item.command) ? item.command.at(-1) : item.command]
    .filter((command): command is string => typeof command === 'string');
  const workingDirectory = resolvePersistedWorkingDirectory(item.cwd);
  if (workingDirectory === null) return;
  const tool = claimPersistedNativeCall('Bash', commands.map(command => ({ command, workingDirectory })), ctx);
  if (!tool || typeof item.aggregated_output !== 'string') return;
  tool.result = item.aggregated_output;
  if (typeof item.exit_code === 'number') {
    tool.status = item.exit_code === 0 ? 'completed' : 'error';
    tool.exitCode = item.exit_code;
    ctx.nativeCommandResultCallIds.add(tool.id);
    if (item.exit_code === 0) {
      const exploration = readPersistedCommandExploration(actions);
      if (exploration) tool.exploration = exploration;
    }
  }
}

function applyPersistedNativeWebSearchItem(
  item: Record<string, unknown> | undefined,
  ctx: PersistedParseContext,
): void {
  if (item?.type !== 'Extension' || item.kind !== 'web.search') return;
  const itemId = typeof item.id === 'string' ? item.id : undefined;
  if (itemId && ctx.observedNativeItemIds.has(itemId)) return;

  const result = formatCodexWebSearchResults(item.results);
  if (!result) return;

  const nativeInput = normalizeCodexToolInput('web_search', {
    query: item.query,
    queries: item.queries,
    url: item.url,
    pattern: item.pattern,
    action: item.action,
  });
  if (!nativeInput.actionType && !nativeInput.query && !nativeInput.url && !nativeInput.pattern) return;
  const toolCall = claimPersistedNativeCall('WebSearch', [nativeInput], ctx);
  if (!toolCall) return;
  toolCall.result = result;
  ctx.nativeWebSearchResultCallIds.add(toolCall.id);
  if (itemId) ctx.observedNativeItemIds.add(itemId);
}

function applyPersistedNativeMcpItem(
  item: Record<string, unknown> | undefined,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  if (item?.type !== 'McpToolCall' && item?.type !== 'mcpToolCall') return;
  const itemId = typeof item.id === 'string' ? item.id : undefined;
  if (itemId && ctx.observedNativeItemIds.has(itemId)) return;
  if (itemId) ctx.observedNativeItemIds.add(itemId);
  const name = normalizeCodexMcpToolName(item.server, item.tool);
  const input = normalizeCodexMcpToolInput(item.arguments);
  let toolCall = claimPersistedNativeCall(name, [input], ctx);
  if (toolCall) {
    ctx.suppressedToolOutputIds.add(toolCall.id);
  } else if (itemId) {
    pushPersistedNormalizedToolCall(itemId, { name, input }, timestamp, ctx);
    toolCall = findPersistedToolCallById(ctx, itemId);
  }
  if (!toolCall) return;
  const completion = normalizeCodexMcpToolCompletion(item.status, item.result, item.error);
  Object.assign(toolCall, {
    name,
    input,
    presentation: presentCodexMcpToolCall(item.server, item.tool),
    status: completion.isError ? 'error' : 'completed',
    result: completion.result,
  });
}

function resolvePersistedImagePath(value: unknown, workingDirectory?: string): string | undefined {
  if (typeof value !== 'string' || !value || value.includes('\0')) return undefined;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith('file:') && !/^[a-z]:[\\/]/i.test(value)) return undefined;
  if (/^[a-z]:[\\/]/i.test(value)) return path.win32.normalize(value);
  if (!value.startsWith('file:') && !path.isAbsolute(value) && !path.win32.isAbsolute(value) && !workingDirectory) return undefined;
  return resolvePersistedWorkingDirectory(value, workingDirectory) || undefined;
}

function applyPersistedNativeImageItem(
  item: Record<string, unknown> | undefined,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  if (!item || typeof item.id !== 'string' || !item.id || ctx.observedNativeItemIds.has(item.id)) return;
  const isGeneration = item.type === 'Extension' && item.kind === 'image_gen.generation';
  if (!isGeneration && item.type !== 'ImageView') return;
  const name = isGeneration ? 'image_gen__imagegen' : 'view_image';
  const imagePath = resolvePersistedImagePath(isGeneration ? item.savedPath : item.path, ctx.workingDirectory);
  const prompt = typeof item.revisedPrompt === 'string' ? item.revisedPrompt : undefined;
  const matches = [...ctx.imageCallCandidates].filter(([, candidate]) => candidate.name === name && (
    isGeneration ? !!prompt && candidate.input.prompt === prompt
      : !!imagePath && resolvePersistedImagePath(candidate.input.file_path ?? candidate.input.path, ctx.workingDirectory) === imagePath
  ));
  const callId = matches.length === 1 ? matches[0][0] : item.id;
  if (!findPersistedToolCallById(ctx, callId)) {
    pushPersistedNormalizedToolCall(callId, {
      name: isGeneration ? name : 'Read',
      input: isGeneration ? { ...(prompt ? { prompt } : {}) } : { file_path: imagePath ?? '' },
    }, timestamp, ctx);
  }
  const tool = findPersistedToolCallById(ctx, callId);
  if (!tool) return;
  tool.presentation = presentCodexImageTool(name);
  const failed = item.status === 'failed' || item.status === 'error' || !!item.failure;
  tool.status = item.status === 'cancelled' ? 'cancelled' : failed ? 'error' : 'completed';
  tool.result = failed ? stringifyCodexToolOutput(item.failure) || 'Image generation failed' : imagePath ?? '';
  let image: ToolResultImage | undefined;
  if (!failed && tool.status === 'completed') {
    const data = parseImageDataUri(item.result);
    if (data) image = { kind: 'data', ...data };
    else if (typeof item.result === 'string' && item.result.startsWith('iVBORw0KGgo')) {
      image = { kind: 'data', data: item.result, mediaType: 'image/png' };
    } else if (!isGeneration && tool.resultImages?.[0]?.kind === 'data') image = tool.resultImages[0];
    else if (imagePath) image = { kind: 'file', path: imagePath };
  }
  tool.resultImages = image ? [image] : undefined;
  ctx.imageCallCandidates.delete(callId);
  ctx.nativeImageResultCallIds.add(callId);
  ctx.observedNativeItemIds.add(item.id);
}

function processEventMsg(
  payload: PersistedEventPayload,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  if (!payload?.type) return;

  switch (payload.type) {
    case 'item_completed': {
      applyPersistedNativeCommandItem(payload.item, ctx);
      applyPersistedNativeWebSearchItem(payload.item, ctx);
      applyPersistedNativeImageItem(payload.item, timestamp, ctx);
      applyPersistedNativeMcpItem(payload.item, timestamp, ctx);
      const activity = normalizeCodexSubagentActivity((payload as Record<string, unknown>).item);
      if (activity?.kind === 'started' && !ctx.toolCallToTurn.has(activity.id)) {
        pushPersistedNormalizedToolCall(
          activity.id,
          { name: 'spawn_agent', input: { task_name: activity.agentPath } },
          timestamp,
          ctx,
        );
      }
      const item = payload.item;
      if (item?.type === 'HookPrompt' || item?.type === 'hookPrompt') {
        appendPersistedStopHook(item.fragments, timestamp, ctx);
        break;
      }
      if ((item?.type === 'AgentMessage' || item?.type === 'agentMessage')
        && item.delivery === 'async' && item.id && Array.isArray(item.questions)) {
        if (!findPersistedToolCallById(ctx, item.id)) {
          processPersistedToolCall({
            type: 'function_call',
            call_id: item.id,
            name: 'request_user_input_async',
            arguments: JSON.stringify({ questions: item.questions }),
          }, timestamp, ctx);
        }
        const questionTool = findPersistedToolCallById(ctx, item.id);
        if (questionTool?.status === 'running') {
          questionTool.status = 'completed';
          questionTool.result = 'Question sent. Awaiting your reply.';
        }
      }
      break;
    }
    case 'task_started': {
      ctx.nativeCallCandidates.length = 0;
      ctx.imageCallCandidates.clear();
      const serverTurnId = extractServerTurnId(payload);
      const id = nextTurnId(ctx);
      const turn = ensureTurn(ctx.turns, ctx.turnOrder, id, null, timestamp);
      turn.startedAt = timestamp;
      if (serverTurnId) turn.serverTurnId = serverTurnId;
      ctx.currentTurnId = turn.id;
      break;
    }

    case 'task_complete': {
      if (ctx.currentTurnId) {
        const turn = ctx.turns.get(ctx.currentTurnId);
        if (turn) {
          turn.completedAt = timestamp;
          turn.completed = true;
          const duration = (payload as Record<string, unknown>).duration_ms;
          if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) turn.durationMs = duration;
          closeAssistantBubble(turn);
          const serverTurnId = extractServerTurnId(payload);
          if (serverTurnId && !turn.serverTurnId) turn.serverTurnId = serverTurnId;
        }
      }
      ctx.currentTurnId = null;
      break;
    }

    case 'turn_aborted': {
      if (ctx.currentTurnId) {
        const turn = ctx.turns.get(ctx.currentTurnId);
        if (turn) {
          const bubble = ensureAssistantBubble(turn, timestamp);
          bubble.interrupted = true;
          const backgroundToolIds = new Set([
            ...ctx.execCellToCommandId.values(),
            ...ctx.terminalSessionToCommandId.values(),
          ]);
          for (const turnBubble of turn.assistantBubbles) {
            for (const tool of turnBubble.toolCalls) {
              const wasAborted = tool.status === 'completed'
                && typeof tool.result === 'string'
                && /^aborted by user(?: after \d+(?:\.\d+)?s)?\s*$/i.test(tool.result);
              if ((tool.status !== 'running' && !wasAborted) || backgroundToolIds.has(tool.id)
                || tool.input.run_in_background === true || tool.subagent) continue;
              tool.status = 'cancelled';
            }
          }
          closeAssistantBubble(turn);
          turn.completedAt = timestamp;
        }
      }
      ctx.currentTurnId = null;
      break;
    }

    case 'user_message': {
      const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
      const msg = payload.message;
      if (typeof msg === 'string') {
        const isQuestionReply = applyPersistedQuestionReplies(msg, ctx);
        const visibleText = extractCodexUserVisibleText(msg);
        if (isQuestionReply || visibleText !== null) {
          appendUserChunk(turn, isQuestionReply ? msg : visibleText!, timestamp);
        }
      }
      break;
    }

    case 'agent_message': {
      const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
      const bubble = ensureAssistantBubble(turn, timestamp);
      const msg = payload.message;
      if (typeof msg === 'string') {
        appendPersistedAssistantText(
          bubble,
          stripCodexMemoryCitationMarkup(msg),
        );
      }
      appendCitationBlock(
        bubble,
        normalizeCodexMemoryCitation(payload.memory_citation ?? payload.memoryCitation),
      );
      break;
    }

    case 'agent_reasoning': {
      const text = extractReasoningText(payload);
      if (!text) break;

      const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
      const bubble = ensureAssistantBubble(turn, timestamp);
      appendOrderedTextChunk(bubble, 'thinking', text);
      break;
    }

    case 'context_compacted': {
      const activeTurnId = ctx.currentTurnId;
      if (activeTurnId) {
        const activeTurn = ctx.turns.get(activeTurnId);
        if (activeTurn) closeAssistantBubble(activeTurn);
      }

      // Auto-compaction can occur in the middle of a running turn. Keep the
      // boundary in that turn so later records retain their turn ownership.
      const turn = ensureTurn(
        ctx.turns,
        ctx.turnOrder,
        nextTurnId(ctx),
        activeTurnId,
        timestamp,
      );
      const bubble = ensureAssistantBubble(turn, timestamp);
      bubble.contentBlocks.push({ type: 'context_compacted' });
      closeAssistantBubble(turn);
      break;
    }

    default:
      break;
  }
}

function appendPersistedStopHook(
  fragments: unknown,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  const feedback = getCodexStopHookFeedback(fragments);
  if (feedback === null || !ctx.currentTurnId) return;
  const turn = ctx.turns.get(ctx.currentTurnId);
  if (!turn) return;
  ensureAssistantBubble(turn, timestamp).contentBlocks.push({ type: 'stop_hook', content: feedback });
}

// ---------------------------------------------------------------------------
// Flush multi-bubble turns to ChatMessage[]
// ---------------------------------------------------------------------------

function flushBubbleTurnMessages(
  turn: CodexTurnState,
  msgIndex: number,
): { messages: ChatMessage[]; nextMsgIndex: number } {
  const messages: ChatMessage[] = [];

  const rawUserText = turn.userChunks.join('\n');
  const isQuestionReply = parseCodexQuestionReply(rawUserText).length > 0;
  const visibleUserText = extractCodexUserVisibleText(rawUserText);
  const userImages = turn.userImages.length > 0 ? turn.userImages : undefined;
  if (visibleUserText || userImages || isQuestionReply) {
    const displayContent = visibleUserText
      ? extractUserDisplayContent(visibleUserText)
      : isQuestionReply ? '' : undefined;
    const executionInput = !isQuestionReply && visibleUserText ? recoverCodexInputContext(visibleUserText) : undefined;
    messages.push({
      id: `codex-msg-${msgIndex}`,
      role: 'user',
      content: isQuestionReply ? rawUserText : visibleUserText ?? '',
      ...(displayContent !== undefined ? { displayContent } : {}),
      ...(executionInput ? { executionInput } : {}),
      ...(userImages ? { images: userImages } : {}),
      ...(isQuestionReply ? { isProviderContinuation: true } : {}),
      ...(turn.serverTurnId ? { userMessageId: turn.serverTurnId } : {}),
      timestamp: turn.userTimestamp || turn.startedAt || Date.now(),
    });
    msgIndex += 1;
  }

  let lastAssistantTimestamp = 0;
  const assistantMessages: ChatMessage[] = [];

  for (const bubble of turn.assistantBubbles) {
    const contentText = bubble.contentChunks.join('\n\n');
    const thinkingText = bubble.thinkingChunks.join('\n\n');
    const hasContent = contentText.trim().length > 0;
    const hasThinking = thinkingText.trim().length > 0;
    const hasToolCalls = bubble.toolCalls.length > 0;
    const hasCitations = bubble.contentBlocks.some(block => block.type === 'citations');
    const hasCompactBoundary = bubble.contentBlocks.some(b => b.type === 'context_compacted');

    if (!hasContent && !hasThinking && !hasToolCalls && !hasCitations && !hasCompactBoundary) {
      if (bubble.interrupted) {
        messages.push({
          id: `codex-msg-${msgIndex}`,
          role: 'assistant',
          content: '',
          timestamp: bubble.startedAt || turn.startedAt || Date.now(),
          isInterrupt: true,
        });
        msgIndex += 1;
      }
      continue;
    }

    const contentBlocks = bubble.contentBlocks;

    const msg: ChatMessage = {
      id: `codex-msg-${msgIndex}`,
      role: 'assistant',
      content: contentText.trim(),
      timestamp: bubble.startedAt || turn.startedAt || Date.now(),
      ...(turn.modelName ? { modelName: turn.modelName } : {}),
      toolCalls: hasToolCalls ? bubble.toolCalls : undefined,
      contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
    };

    if (bubble.interrupted) {
      msg.isInterrupt = true;
    }

    if (bubble.lastEventAt > lastAssistantTimestamp) {
      lastAssistantTimestamp = bubble.lastEventAt;
    }

    assistantMessages.push(msg);
    messages.push(msg);
    msgIndex += 1;
  }

  if (assistantMessages.length > 0) {
    const lastMsg = assistantMessages[assistantMessages.length - 1];
    if (turn.durationMs !== undefined) {
      lastMsg.durationSeconds = turn.durationMs / 1000;
    } else if (turn.userTimestamp && lastAssistantTimestamp > turn.userTimestamp) {
      lastMsg.durationSeconds = Math.round((lastAssistantTimestamp - turn.userTimestamp) / 1000);
    }
  }

  if (turn.serverTurnId && turn.completed && assistantMessages.length > 0) {
    const lastNonInterrupt = [...assistantMessages].reverse().find(m => !m.isInterrupt);
    if (lastNonInterrupt) {
      lastNonInterrupt.assistantMessageId = turn.serverTurnId;
      lastNonInterrupt.turnStats = createTurnStats(turn.outputTokens, turn.durationMs);
    }
  }

  return { messages, nextMsgIndex: msgIndex };
}

// ---------------------------------------------------------------------------
// Session file discovery
// ---------------------------------------------------------------------------

const SAFE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function getPathModuleForSessionPath(sessionPath: string): typeof path.posix {
  return sessionPath.includes('\\') || /^[A-Za-z]:/.test(sessionPath)
    ? path.win32
    : path.posix;
}

export function deriveCodexSessionsRootFromSessionPath(
  sessionFilePath: string | null | undefined,
): string | null {
  if (!sessionFilePath) {
    return null;
  }

  const pathModule = getPathModuleForSessionPath(sessionFilePath);
  let current = pathModule.dirname(pathModule.normalize(sessionFilePath));
  let previous: string | null = null;

  while (current && current !== previous) {
    if (pathModule.basename(current).toLowerCase() === 'sessions') {
      return current;
    }
    previous = current;
    current = pathModule.dirname(current);
  }

  return null;
}

export function deriveCodexMemoriesDirFromSessionsRoot(
  sessionsDir: string | null | undefined,
): string | null {
  if (!sessionsDir) {
    return null;
  }

  const pathModule = getPathModuleForSessionPath(sessionsDir);
  return pathModule.join(pathModule.dirname(sessionsDir), 'memories');
}

export function findCodexSessionFile(
  threadId: string,
  root: string = path.join(os.homedir(), '.codex', 'sessions'),
): string | null {
  if (!threadId || !SAFE_SESSION_ID_PATTERN.test(threadId) || !fs.existsSync(root)) {
    return null;
  }

  const directPath = path.join(root, `${threadId}.jsonl`);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && (entry.name.endsWith(`-${threadId}.jsonl`) || entry.name.endsWith(`-${threadId}.jsonl.zst`) || entry.name === `${threadId}.jsonl.zst`)) {
        return fullPath;
      }
    }
  }

  return null;
}

export async function findCodexSessionFileAsync(
  threadId: string,
  root: string = path.join(os.homedir(), '.codex', 'sessions'),
  timeoutMs = 10_000,
  dependencies: CodexSessionFileLookupDependencies = {},
): Promise<string | null> {
  if (!threadId || !SAFE_SESSION_ID_PATTERN.test(threadId)) {
    return null;
  }

  const deadline = Date.now() + Math.max(0, timeoutMs);
  const pathExists = dependencies.pathExists ?? defaultPathExists;
  const readDirectory = dependencies.readDirectory
    ?? ((value: string) => fsp.readdir(value, { withFileTypes: true }));
  try {
    if (!(await runBeforeDeadline(() => pathExists(root), deadline))) {
      return null;
    }
    const directPath = path.join(root, `${threadId}.jsonl`);
    if (await runBeforeDeadline(() => pathExists(directPath), deadline)) {
      return directPath;
    }
  } catch {
    return null;
  }

  const stack = [root];
  while (stack.length > 0 && Date.now() <= deadline) {
    const current = stack.pop();
    if (!current) continue;

    let entries: fs.Dirent[];
    try {
      entries = await runBeforeDeadline(() => readDirectory(current), deadline);
    } catch {
      if (Date.now() >= deadline) {
        return null;
      }
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith(`-${threadId}.jsonl`) || entry.name.endsWith(`-${threadId}.jsonl.zst`) || entry.name === `${threadId}.jsonl.zst`)) {
        return fullPath;
      }
    }
  }
  return null;
}

export interface CodexSessionFileLookupDependencies {
  pathExists?: (value: string) => Promise<boolean>;
  readDirectory?: (value: string) => Promise<fs.Dirent[]>;
}

async function runBeforeDeadline<T>(
  operation: () => Promise<T>,
  deadline: number,
): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new Error('Codex history lookup deadline exceeded.');
  }

  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('Codex history lookup deadline exceeded.'));
    }, remainingMs);
    operation().then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function defaultPathExists(value: string): Promise<boolean> {
  try {
    await fsp.access(value);
    return true;
  } catch {
    return false;
  }
}

export function parseCodexSessionFile(filePath: string): ChatMessage[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  return parseCodexSessionContent(content);
}

export async function readCodexSessionRecords(filePath: string, timeoutMs = 10_000): Promise<CodexSessionRecord[] | null> {
  const records: CodexSessionRecord[] = [];
  try {
    await forEachJSONLLine(filePath, (line) => {
      const record = parseSessionRecord(line);
      if (record) records.push(record);
    }, { timeoutMs });
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null;
    throw error;
  }
  return records;
}

/** Missing transcripts have no history; other read failures reject. */
export async function parseCodexSessionFileAsync(filePath: string, timeoutMs = 10_000): Promise<ChatMessage[]> {
  const records = await readCodexSessionRecords(filePath, timeoutMs);
  return records ? parseCodexSessionTurns(records).flatMap(turn => turn.messages) : [];
}

export interface CodexParsedTurn {
  turnId: string | null;
  messages: ChatMessage[];
}

export function parseCodexSessionContent(content: string): ChatMessage[] {
  const turns = parseCodexSessionTurns(content);
  return turns.flatMap(t => t.messages);
}

export function parseCodexSessionModel(
  content: string,
  resumeAtTurnId?: string,
): string | null {
  const reader = new SessionModelReader(resumeAtTurnId);
  for (const line of content.split(/\r?\n/)) {
    reader.accept(line);
    if (reader.reached) break;
  }
  return reader.result();
}

class SessionModelReader {
  model: string | null = null;
  reached = false;

  constructor(private readonly checkpoint?: string) {}

  accept(line: string): void {
    try {
      const record = JSON.parse(line) as {
        type?: unknown;
        payload?: { model?: unknown; turn_id?: unknown };
      } | null;
      if (record?.type !== 'turn_context') return;

      const candidate = typeof record.payload?.model === 'string'
        ? record.payload.model.trim()
        : '';
      if (candidate) this.model = candidate;
      if (this.checkpoint && record.payload?.turn_id === this.checkpoint) {
        this.reached = true;
      }
    } catch {
      // Ignore malformed provider-native transcript records.
    }
  }

  result(): string | null {
    return this.checkpoint && !this.reached ? null : this.model;
  }
}

/** Reads only the model metadata needed for recovery, stopping at a checkpoint. */
export async function readCodexSessionModel(
  filePath: string,
  resumeAtTurnId?: string,
  timeoutMs = 10_000,
): Promise<string | null> {
  const reader = new SessionModelReader(resumeAtTurnId);
  await forEachJSONLLine(filePath, line => {
    reader.accept(line);
    return !reader.reached;
  }, { timeoutMs, chunkBytes: 64 * 1024 });
  return reader.result();
}

export function parseCodexSessionRecordLines(lines: readonly string[]): CodexSessionRecord[] {
  return lines.map(parseSessionRecord).filter((record): record is CodexSessionRecord => record !== null);
}

export function parseCodexSessionTurns(content: string | CodexSessionRecord[], throughTurnId?: string): CodexParsedTurn[] {
  let records = typeof content === 'string' ? parseCodexSessionRecordLines(content.split('\n')) : content;
  if (throughTurnId) {
    let reached = false;
    const nextTurn = records.findIndex(record => {
      const payload = record.payload as Record<string, unknown> | undefined;
      if (record.type !== 'event_msg' || payload?.type !== 'task_started') return false;
      if (reached && payload.turn_id !== throughTurnId) return true;
      if (payload.turn_id === throughTurnId) reached = true;
      return false;
    });
    if (nextTurn >= 0) records = records.slice(0, nextTurn);
  }
  const hasModern = records.some(record => record.type === 'event_msg' || record.type === 'response_item' || record.type === 'compacted');
  if (!hasModern && records.some(record => record.type === 'event')) {
    const messages = parseLegacySession(records);
    return messages.length > 0 ? [{ turnId: null, messages }] : [];
  }

  // Modern or mixed sessions use the bubble model with turn-level grouping
  return parseModernSessionTurns(records);
}

// ---------------------------------------------------------------------------
// Legacy (event wrapper) parser — preserved for backward compat
// ---------------------------------------------------------------------------

function parseLegacySession(records: CodexSessionRecord[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let turn = newTurn();
  let msgIndex = 0;

  for (const parsed of records) {
    if (parsed.type === 'event' && parsed.event) {
      const event = parsed.event;

      switch (event.type) {
        case 'turn.started':
          if (turn.assistantText || turn.thinkingText || turn.toolCalls.length > 0) {
            msgIndex = flushTurn(turn, messages, msgIndex);
          }
          turn = newTurn();
          break;

        case 'item.started':
        case 'item.updated':
        case 'item.completed':
          if (event.item) {
            processLegacyItem(event.type, event.item, turn);
          }
          break;

        case 'turn.completed':
          msgIndex = flushTurn(turn, messages, msgIndex);
          turn = newTurn();
          break;

        case 'turn.failed':
          turn.interrupted = true;
          msgIndex = flushTurn(turn, messages, msgIndex);
          turn = newTurn();
          break;

        default:
          break;
      }
    }
  }

  flushTurn(turn, messages, msgIndex);
  return messages;
}

// ---------------------------------------------------------------------------
// Modern (response_item + event_msg) parser — bubble model
// ---------------------------------------------------------------------------

function parseModernSessionTurns(records: CodexSessionRecord[]): CodexParsedTurn[] {
  const ctx = createPersistedParseContext();
  let threadId: string | undefined;
  // User input may open a new replay turn within the same native task.
  let activeNativeTurnId: string | undefined;
  const turnModels = new Map<string, string>();
  const turnOutputTokens = new Map<string, number | undefined>();
  const rawCallIds = new Set<string>();
  const compactedRecordsWithEvent = new Set<CodexSessionRecord>();
  let pendingCompactionRecord: CodexSessionRecord | undefined;

  // Index completed script failures before projecting their calls. Also pair
  // older compaction records with their explicit marker without replaying context.
  for (const record of records) {
    const payload = record.payload;
    if (record.type === 'event_msg' && payload?.type === 'item_completed') {
      const item = payload.item;
      if ((item?.type === 'AgentMessage' || item?.type === 'agentMessage')
        && typeof item.id === 'string' && item.id && !ctx.nativeMessageCitations.has(item.id)) {
        // Correlate with the response record by identity, regardless of record order.
        const citations = normalizeCodexMemoryCitation(item.memory_citation ?? item.memoryCitation);
        if (citations) ctx.nativeMessageCitations.set(item.id, citations);
      }
    }
    if (record.type === 'response_item'
      && (payload?.type === 'function_call' || payload?.type === 'custom_tool_call')) {
      const call = payload as PersistedToolCallPayload;
      if (call.call_id) rawCallIds.add(call.call_id);
    }
    if (record.type === 'response_item'
      && (payload?.type === 'custom_tool_call_output' || payload?.type === 'function_call_output')) {
      const output = payload as PersistedToolCallOutputPayload;
      if (output.call_id && /^Script failed(?:\r?\n|$)/.test(stringifyCodexToolOutput(output.output))) {
        ctx.failedExecCallIds.add(output.call_id);
      }
    }
    if (record.type === 'compacted') {
      pendingCompactionRecord = record;
    } else if (record.type === 'event_msg' && payload?.type === 'context_compacted') {
      if (pendingCompactionRecord) compactedRecordsWithEvent.add(pendingCompactionRecord);
      pendingCompactionRecord = undefined;
    } else if (record.type === 'response_item' || record.type === 'event_msg') {
      // A later visible turn must not consume an earlier record-only boundary.
      pendingCompactionRecord = undefined;
    }
  }

  for (const [lineIndex, parsed] of records.entries()) {
    const timestamp = parsed.timestamp;
    const payload = parsed.payload as Record<string, unknown> | undefined;
    if (parsed.type === 'session_meta') {
      threadId ??= typeof payload?.id === 'string' ? payload.id : undefined;
    }
    if (parsed.type === 'turn_context') {
      if (typeof payload?.cwd === 'string') ctx.workingDirectory = payload.cwd;
      const model = typeof payload?.model === 'string' ? payload.model.trim() : '';
      const nativeTurnId = typeof payload?.turn_id === 'string' && payload.turn_id.trim() ? payload.turn_id : undefined;
      if (model && (payload?.turn_id === undefined || nativeTurnId)) {
        const modelName = formatCodexModelLabel(model);
        if (nativeTurnId) turnModels.set(nativeTurnId, modelName);
        const turn = ctx.currentTurnId ? ctx.turns.get(ctx.currentTurnId) : undefined;
        if (turn && (!nativeTurnId || nativeTurnId === activeNativeTurnId || nativeTurnId === turn.serverTurnId)) {
          turn.modelName = modelName;
        }
      }
    }
    if (parsed.type === 'token_usage_record' && threadId && payload?.thread_id === threadId) {
      if (typeof payload.turn_id === 'string') {
        const usage = payload.turn_token_usage as { output_tokens?: unknown } | undefined;
        turnOutputTokens.set(
          payload.turn_id,
          isTokenCount(usage?.output_tokens) ? usage.output_tokens : undefined,
        );
      }
      continue;
    }

    // Legacy event records can appear in mixed sessions
    if (parsed.type === 'event' && parsed.event) {
      processLegacyEventInModernContext(parsed.event, timestamp, ctx);
      continue;
    }

    if (parsed.type === 'event_msg') {
      if (payload?.type === 'task_started') activeNativeTurnId = extractServerTurnId(parsed.payload as PersistedEventPayload);
      const activity = payload?.type === 'item_completed'
        ? normalizeCodexSubagentActivity(payload.item)
        : undefined;
      if (activity?.kind === 'interacted' && !rawCallIds.has(activity.id)
        && !ctx.toolCallToTurn.has(activity.id)) {
        pushPersistedNormalizedToolCall(
          activity.id,
          { name: 'send_input', input: { id: activity.agentThreadId } },
          timestamp,
          ctx,
        );
        processPersistedToolOutput({ type: 'function_call_output', call_id: activity.id, output: '' }, timestamp, ctx);
      }
      processEventMsg(parsed.payload as PersistedEventPayload, timestamp, ctx);
      if (payload?.type === 'task_complete' || payload?.type === 'turn_aborted') activeNativeTurnId = undefined;
      continue;
    }

    if (parsed.type === 'compacted') {
      // Newer transcripts can omit the companion context_compacted event.
      // Restore only the boundary, never replacement_history or its summary.
      if (!compactedRecordsWithEvent.has(parsed)) {
        processEventMsg({ type: 'context_compacted' }, timestamp, ctx);
      }
      continue;
    }

    if (parsed.type === 'response_item') {
      processPersistedPayload(parsed.payload, timestamp, lineIndex, ctx);
    }
  }

  for (const turn of ctx.turns.values()) {
    if (turn.serverTurnId) {
      turn.outputTokens = turnOutputTokens.get(turn.serverTurnId);
      turn.modelName = turnModels.get(turn.serverTurnId) ?? turn.modelName;
    }
  }
  deduplicatePersistedImageViewPreviews(ctx);
  deduplicatePersistedImageGenerationHints(ctx);
  const turns = flushBubbleTurnsGrouped(ctx.turns, ctx.turnOrder);
  const tools = turns.flatMap(turn => turn.messages.flatMap(message => message.toolCalls ?? []));
  const agents = new Map<string, ToolCallInfo>();
  const pendingInteractions = new Map<string, { tool: ToolCallInfo; info: SubagentInfo }>();
  for (const record of records) {
    if (record.type !== 'event_msg') continue;
    const event = record.payload as Record<string, unknown> | undefined;
    if (event?.type !== 'item_completed') continue;
    const activity = normalizeCodexSubagentActivity(event.item);
    if (!activity) continue;
    const interaction = tools.find(candidate => candidate.id === activity.id);
    const interactionKey = JSON.stringify([activity.agentThreadId, event.turn_id]);
    const canonicalInteraction = activity.kind === 'interacted' && !rawCallIds.has(activity.id);
    const startsWork = activity.kind === 'started' || (activity.kind === 'interacted'
      && !canonicalInteraction && ['followup_task', 'resume_agent', 'send_input'].includes(interaction?.name ?? ''));
    const previous = agents.get(activity.agentThreadId);
    if (canonicalInteraction && interaction) {
      if (previous?.subagent?.status !== 'running' && !pendingInteractions.has(interactionKey)) {
        const info = applyCodexSubagentActivity(
          activity,
          buildCodexSubagentInfo(interaction),
          record.timestamp,
          true,
        );
        if (previous?.subagent) info.description = previous.subagent.description;
        pendingInteractions.set(interactionKey, { tool: interaction, info });
      }
      continue;
    }
    const pending = pendingInteractions.get(interactionKey);
    const completesPending = pending && (activity.kind === 'completed' || activity.kind === 'interrupted');
    const tool = startsWork ? interaction : completesPending ? pending.tool : previous;
    if (!tool) continue;
    const initial = completesPending ? pending.info : tool.subagent ?? buildCodexSubagentInfo(tool);
    if (startsWork && previous?.subagent) initial.description = previous.subagent.description;
    tool.subagent = applyCodexSubagentActivity(activity, initial, record.timestamp, startsWork);
    if (startsWork || completesPending) pendingInteractions.delete(interactionKey);
    agents.set(activity.agentThreadId, tool);
  }
  return turns;
}

function flushBubbleTurnsGrouped(
  turns: Map<string, CodexTurnState>,
  turnOrder: string[],
): CodexParsedTurn[] {
  const result: CodexParsedTurn[] = [];
  let messageOffset = 0;

  for (const turnId of turnOrder) {
    const turn = turns.get(turnId);
    if (!turn) continue;
    const { messages: turnMessages, nextMsgIndex } = flushBubbleTurnMessages(turn, messageOffset);
    if (turnMessages.length === 0) continue;
    messageOffset = nextMsgIndex;

    result.push({
      turnId: turn.serverTurnId ?? null,
      messages: turnMessages,
    });
  }

  return result;
}

function findToolCallOrigin(
  ctx: PersistedParseContext,
  callId: string,
): ToolCallInfo | null {
  const origin = ctx.toolCallToTurn.get(callId);
  if (!origin) {
    return null;
  }

  const turn = ctx.turns.get(origin.turnId);
  if (!turn || origin.bubbleIndex >= turn.assistantBubbles.length) {
    return null;
  }

  return turn.assistantBubbles[origin.bubbleIndex].toolCalls.find(tool => tool.id === callId) ?? null;
}

function trackToolCallOrigin(
  ctx: PersistedParseContext,
  callId: string,
  turn: CodexTurnState,
): void {
  ctx.toolCallToTurn.set(callId, {
    turnId: turn.id,
    bubbleIndex: turn.activeBubbleIndex!,
  });
}

function ensureModernLegacyToolCall(
  ctx: PersistedParseContext,
  timestamp: number,
  item: CodexItem,
  build: () => ToolCallInfo,
): ToolCallInfo {
  const existing = findToolCallOrigin(ctx, item.id);
  if (existing) {
    return existing;
  }

  const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
  const bubble = ensureAssistantBubble(turn, timestamp);
  const toolCall = build();
  pushToolInvocation(bubble, toolCall);
  trackToolCallOrigin(ctx, item.id, turn);
  return toolCall;
}

function processLegacyItemInModernContext(
  eventType: string,
  item: CodexItem,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  switch (item.type) {
    case 'agent_message': {
      if ((eventType === 'item.updated' || eventType === 'item.completed') && item.text) {
        const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
        const bubble = ensureAssistantBubble(turn, timestamp);
        replaceLatestOrderedTextChunk(
          bubble,
          'text',
          stripCodexMemoryCitationMarkup(item.text),
        );
      }
      break;
    }

    case 'reasoning': {
      if ((eventType === 'item.updated' || eventType === 'item.completed') && item.text) {
        const turn = ensureTurn(ctx.turns, ctx.turnOrder, nextTurnId(ctx), ctx.currentTurnId, timestamp);
        const bubble = ensureAssistantBubble(turn, timestamp);
        replaceLatestOrderedTextChunk(bubble, 'thinking', item.text);
      }
      break;
    }

    case 'command_execution': {
      const presentation = presentCodexCommand({
        command: item.command,
        cwd: item.cwd,
        commandActions: item.commandActions,
      });
      if (eventType === 'item.started') {
        ensureModernLegacyToolCall(ctx, timestamp, item, () => ({
          id: item.id,
          name: normalizeCodexToolName(item.type),
          input: normalizeCodexToolInput(item.type, { command: item.command ?? '' }),
          ...(presentation ? { presentation } : {}),
          status: 'running',
        }));
        break;
      }

      if (eventType === 'item.completed') {
        const toolCall = ensureModernLegacyToolCall(ctx, timestamp, item, () => ({
          id: item.id,
          name: normalizeCodexToolName(item.type),
          input: normalizeCodexToolInput(item.type, { command: item.command ?? '' }),
          ...(presentation ? { presentation } : {}),
          status: 'running',
        }));
        if (presentation) toolCall.presentation = presentation;
        const rawOutput = item.aggregated_output ?? '';
        toolCall.result = normalizeCodexToolResult(toolCall.name, rawOutput);
        toolCall.status = item.exit_code === 0 ? 'completed' : 'error';
        if (typeof item.exit_code === 'number') toolCall.exitCode = item.exit_code;
      }
      break;
    }

    case 'file_change': {
      if (eventType !== 'item.started' && eventType !== 'item.completed') {
        break;
      }

      const changes = item.changes ?? [];
      const toolCall = ensureModernLegacyToolCall(ctx, timestamp, item, () => ({
        id: item.id,
        name: normalizeCodexToolName('file_change'),
        input: { changes },
        presentation: presentCodexFileChange(changes, item.cwd),
        status: 'running',
      }));

      if (eventType === 'item.completed') {
        const paths = changes.map(change => `${change.kind}: ${change.path}`).join(', ');
        toolCall.result = paths ? `Applied: ${paths}` : 'Applied';
        toolCall.status = item.status === 'completed' ? 'completed' : 'error';
      }
      break;
    }

    case 'web_search': {
      if (eventType === 'item.started') {
        ensureModernLegacyToolCall(ctx, timestamp, item, () => ({
          id: item.id,
          name: normalizeCodexToolName(item.type),
          input: normalizeCodexToolInput(item.type, { query: item.query ?? '' }),
          status: 'running',
        }));
        break;
      }

      if (eventType === 'item.completed') {
        const toolCall = ensureModernLegacyToolCall(ctx, timestamp, item, () => ({
          id: item.id,
          name: normalizeCodexToolName(item.type),
          input: normalizeCodexToolInput(item.type, { query: item.query ?? '' }),
          status: 'running',
        }));
        toolCall.result = 'Search complete';
        toolCall.status = 'completed';
      }
      break;
    }

    case 'mcp_tool_call': {
      if (eventType === 'item.started') {
        ensureModernLegacyToolCall(ctx, timestamp, item, () => ({
          id: item.id,
          name: `mcp__${item.server ?? ''}__${item.tool ?? ''}`,
          input: normalizeCodexMcpToolInput(item.arguments),
          presentation: presentCodexMcpToolCall(item.server, item.tool),
          status: 'running',
        }));
        break;
      }

      if (eventType === 'item.completed') {
        const toolCall = ensureModernLegacyToolCall(ctx, timestamp, item, () => ({
          id: item.id,
          name: `mcp__${item.server ?? ''}__${item.tool ?? ''}`,
          input: {},
          presentation: presentCodexMcpToolCall(item.server, item.tool),
          status: 'running',
        }));
        const completion = normalizeCodexMcpToolCompletion(item.status, item.result, item.error);
        toolCall.status = completion.isError ? 'error' : 'completed';
        toolCall.result = completion.result;
      }
      break;
    }

    default:
      break;
  }
}

function processLegacyEventInModernContext(
  event: CodexEvent,
  timestamp: number,
  ctx: PersistedParseContext,
): void {
  switch (event.type) {
    case 'turn.started': {
      if (ctx.currentTurnId) {
        const previousTurn = ctx.turns.get(ctx.currentTurnId);
        if (previousTurn) {
          closeAssistantBubble(previousTurn);
        }
      }
      const id = nextTurnId(ctx);
      ensureTurn(ctx.turns, ctx.turnOrder, id, null, timestamp);
      ctx.currentTurnId = id;
      break;
    }

    case 'turn.completed': {
      if (ctx.currentTurnId) {
        const turn = ctx.turns.get(ctx.currentTurnId);
        if (turn) closeAssistantBubble(turn);
      }
      ctx.currentTurnId = null;
      break;
    }

    case 'turn.failed': {
      if (ctx.currentTurnId) {
        const turn = ctx.turns.get(ctx.currentTurnId);
        if (turn) {
          const bubble = ensureAssistantBubble(turn, timestamp);
          bubble.interrupted = true;
          closeAssistantBubble(turn);
        }
      }
      ctx.currentTurnId = null;
      break;
    }

    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      if (event.item) {
        processLegacyItemInModernContext(event.type, event.item, timestamp, ctx);
      }
      break;

    default:
      break;
  }
}
