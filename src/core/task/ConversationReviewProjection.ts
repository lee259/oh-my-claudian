import {
  TOOL_ASK_USER_QUESTION,
  TOOL_EXIT_PLAN_MODE,
} from '../tools/toolNames';
import type {
  Conversation,
  ConversationTask,
  ToolCallInfo,
} from '../types';
import { isCanonicalUserMessage } from '../types';

export interface ConversationReviewFileChange {
  path: string;
  added: number;
  removed: number;
  toolIds: string[];
}

export type ConversationReviewInteractionKind = 'question' | 'blocked-tool';

export interface ConversationReviewInteraction {
  toolId: string;
  kind: ConversationReviewInteractionKind;
}

export interface ConversationReviewProjection {
  conversationId: string;
  title: string;
  currentNote?: string;
  task: ConversationTask | null;
  goal: string | null;
  latestAssistantResult: string | null;
  hasCompletedAssistantTurn: boolean;
  latestPlan: string | null;
  changedFiles: ConversationReviewFileChange[];
  unresolvedInteractions: ConversationReviewInteraction[];
}

export function buildConversationReviewProjection(
  conversation: Conversation,
): ConversationReviewProjection {
  const files = new Map<string, ConversationReviewFileChange>();
  const interactions: ConversationReviewInteraction[] = [];
  let latestPlan: string | null = null;
  const hasCompletedAssistantTurn = conversation.messages.some(message => (
    message.role === 'assistant'
    && !message.isRebuiltContext
    && !message.isInterrupt
  ));
  const goal = conversation.messages.find(isCanonicalUserMessage)?.content.trim() || null;
  const latestAssistantResult = [...conversation.messages]
    .reverse()
    .find(message => message.role === 'assistant' && !message.isRebuiltContext && !message.isInterrupt)
    ?.content.trim() || null;

  for (const message of conversation.messages) {
    for (const toolCall of message.toolCalls ?? []) {
      const result = collectToolCallProjection(toolCall, files, interactions);
      if (result.plan !== null) latestPlan = result.plan;
    }
  }

  return {
    conversationId: conversation.id,
    title: conversation.title,
    ...(conversation.currentNote ? { currentNote: conversation.currentNote } : {}),
    task: conversation.task ? { ...conversation.task } : null,
    goal,
    latestAssistantResult,
    hasCompletedAssistantTurn,
    latestPlan,
    changedFiles: [...files.values()].map(file => ({
      ...file,
      toolIds: [...file.toolIds],
    })),
    unresolvedInteractions: interactions,
  };
}

function collectToolCallProjection(
  toolCall: ToolCallInfo,
  files: Map<string, ConversationReviewFileChange>,
  interactions: ConversationReviewInteraction[],
): { plan: string | null } {
  const plan = extractPlan(toolCall);
  collectFileChange(toolCall, files);
  collectInteraction(toolCall, interactions);

  for (const nestedToolCall of toolCall.subagent?.toolCalls ?? []) {
    const nested = collectToolCallProjection(nestedToolCall, files, interactions);
    if (nested.plan !== null) return { plan: nested.plan };
  }

  return { plan };
}

function extractPlan(toolCall: ToolCallInfo): string | null {
  if (toolCall.name !== TOOL_EXIT_PLAN_MODE) return null;
  const planContent = toolCall.input.planContent;
  return typeof planContent === 'string' && planContent.trim()
    ? planContent.trim()
    : null;
}

function collectFileChange(
  toolCall: ToolCallInfo,
  files: Map<string, ConversationReviewFileChange>,
): void {
  const diffData = toolCall.diffData;
  const path = normalizeReviewPath(diffData?.filePath);
  if (!diffData || !path) return;

  const existing = files.get(path);
  if (existing) {
    existing.added += normalizeCount(diffData.stats.added);
    existing.removed += normalizeCount(diffData.stats.removed);
    if (!existing.toolIds.includes(toolCall.id)) existing.toolIds.push(toolCall.id);
    return;
  }

  files.set(path, {
    path,
    added: normalizeCount(diffData.stats.added),
    removed: normalizeCount(diffData.stats.removed),
    toolIds: [toolCall.id],
  });
}

function collectInteraction(
  toolCall: ToolCallInfo,
  interactions: ConversationReviewInteraction[],
): void {
  if (
    toolCall.name === TOOL_ASK_USER_QUESTION
    && (toolCall.status === 'running' || toolCall.status === 'blocked')
    && !toolCall.resolvedAnswers
  ) {
    interactions.push({ toolId: toolCall.id, kind: 'question' });
    return;
  }

  if (toolCall.status === 'blocked') {
    interactions.push({ toolId: toolCall.id, kind: 'blocked-tool' });
  }
}

function normalizeReviewPath(path: string | undefined): string | null {
  if (typeof path !== 'string') return null;
  const normalized = path.trim().replace(/\\/g, '/');
  return normalized || null;
}

function normalizeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
