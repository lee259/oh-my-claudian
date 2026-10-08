import type { ChatMessage, ContentBlock } from '../types/chat';
import { isCanonicalUserMessage } from '../types/chat';
import type { ToolCallInfo } from '../types/tools';

export type TranscriptRunStatus = 'streaming' | 'completed' | 'interrupted';

export interface ProjectedTranscriptBlock {
  /** Stable within the conversation; a live block keeps this ID when committed. */
  id: string;
  turnId: string;
  runId: string;
  messageId: string;
  executionId?: string;
  executionTurnId?: string;
  blockIndex: number;
  block: ContentBlock;
  toolCall?: ToolCallInfo;
}

export interface TranscriptRunProjection {
  /** Stable Claudian assistant-message identity for this provider-neutral run. */
  id: string;
  turnId: string;
  messageId: string;
  /** Source message retained so consumers do not need a parallel message lookup. */
  message: Readonly<ChatMessage>;
  isAutomaticResponse: boolean;
  status: TranscriptRunStatus;
  /** Ephemeral coordinator scope; omitted from persisted conversation messages. */
  executionId?: string;
  executionTurnId?: string;
  blocks: ProjectedTranscriptBlock[];
}

export interface TranscriptTurnProjection {
  /** Canonical user-message ID, or the first assistant ID for a detached history run. */
  id: string;
  userMessageId?: string;
  /** Canonical user message; omitted only for detached assistant history. */
  userMessage?: Readonly<ChatMessage>;
  runs: TranscriptRunProjection[];
  /** Assistant blocks in original turn order, retaining their run ownership. */
  blocks: ProjectedTranscriptBlock[];
}

export interface TranscriptProjectionOptions {
  /** The assistant message that currently owns an uncommitted streaming block. */
  activeMessageId?: string;
  /** Current block not yet appended to ChatMessage.contentBlocks. */
  liveBlock?: ContentBlock;
  /** Current provider-neutral execution scope, supplied only while the run is live. */
  executionScope?: { executionId?: string; turnId: string };
}

/** Returns the provider-neutral identity used by a message's projected block. */
export function getTranscriptBlockId(
  messageId: string,
  block: ContentBlock,
  blockIndex: number,
): string {
  if (block.id) return block.id;
  const itemKey = block.type === 'tool_use'
    ? `tool:${block.toolId}`
    : block.type === 'subagent'
      ? `agent:${block.subagentId}`
      : `block:${blockIndex}`;
  return `${messageId}:${itemKey}`;
}

/**
 * Projects Claudian messages into user turns and assistant runs without changing
 * persisted message data or interpreting provider-owned transcript formats.
 * A live block is appended at the next block index so its identity survives commit.
 */
export function projectTranscript(
  messages: readonly ChatMessage[],
  options: TranscriptProjectionOptions = {},
): TranscriptTurnProjection[] {
  const turns: TranscriptTurnProjection[] = [];
  let currentTurn: TranscriptTurnProjection | undefined;

  for (const message of messages) {
    if (isCanonicalUserMessage(message)) {
      currentTurn = {
        id: message.id,
        userMessageId: message.id,
        userMessage: message,
        runs: [],
        blocks: [],
      };
      turns.push(currentTurn);
      continue;
    }
    if (message.role !== 'assistant' || message.isRebuiltContext) continue;

    if (!currentTurn) {
      currentTurn = { id: message.id, runs: [], blocks: [] };
      turns.push(currentTurn);
    }

    const run = projectMessageRun(
      message,
      currentTurn.id,
      options.activeMessageId === message.id ? options : {},
    );
    currentTurn.runs.push(run);
    currentTurn.blocks.push(...run.blocks);
  }

  return turns;
}

export function projectMessageRun(
  message: ChatMessage,
  turnId: string,
  options: TranscriptProjectionOptions = {},
): TranscriptRunProjection {
  const isActive = options.activeMessageId === message.id;
  const blocks = [...(message.contentBlocks ?? [])];
  if (isActive && options.liveBlock) {
    blocks.push(options.liveBlock);
  } else if (blocks.length === 0 && message.content.trim()) {
    blocks.push({ type: 'text', content: message.content });
  }

  const runId = message.id;
  const status: TranscriptRunStatus = message.isInterrupt
    ? 'interrupted'
    : isActive
      ? 'streaming'
      : 'completed';
  const toolCalls = new Map((message.toolCalls ?? []).map((toolCall) => [toolCall.id, toolCall]));
  const projectedBlocks = blocks.map((block, blockIndex): ProjectedTranscriptBlock => {
    return {
      id: getTranscriptBlockId(message.id, block, blockIndex),
      turnId,
      runId,
      messageId: message.id,
      ...(options.executionScope?.executionId
        ? { executionId: options.executionScope.executionId }
        : {}),
      ...(options.executionScope?.turnId
        ? { executionTurnId: options.executionScope.turnId }
        : {}),
      blockIndex,
      block,
      ...(block.type === 'tool_use' && toolCalls.has(block.toolId)
        ? { toolCall: toolCalls.get(block.toolId) }
        : {}),
    };
  });

  return {
    id: runId,
    turnId,
    messageId: message.id,
    message,
    isAutomaticResponse: !!message.isAutomaticResponse,
    status,
    ...(options.executionScope
      ? {
        executionId: options.executionScope.executionId,
        executionTurnId: options.executionScope.turnId,
      }
      : {}),
    blocks: projectedBlocks,
  };
}

export function findTranscriptRun(
  turns: readonly TranscriptTurnProjection[],
  messageId: string,
): TranscriptRunProjection | undefined {
  for (const turn of turns) {
    const run = turn.runs.find((candidate) => candidate.messageId === messageId);
    if (run) return run;
  }
  return undefined;
}
