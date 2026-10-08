import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ChatMessage, ContentBlock } from '../../../core/types';
import type { ToolCallInfo } from '../../../core/types/tools';
import { normalizeOmpToolInput, normalizeOmpToolName } from '../normalization/ompToolNormalization';

export function parseOmpSessionContent(content: string): ChatMessage[] {
  const entries: Record<string, unknown>[] = [];
  for (const line of content.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed)) entries.push(parsed);
    } catch {
      continue;
    }
  }

  const toolResults = getToolResults(entries);
  const messages: ChatMessage[] = [];
  for (const entry of entries) {
    if (entry.type !== 'message' || !isRecord(entry.message)) continue;
    const message = entry.message;
    const role = typeof message.role === 'string' ? message.role : '';
    const id = typeof entry.id === 'string' ? entry.id : `omp-${messages.length}`;
    const timestamp = getTimestamp(message.timestamp ?? entry.timestamp);
    if (role === 'user') {
      messages.push({
        content: getText(message.content),
        id,
        role: 'user',
        timestamp,
        userMessageId: id,
      });
      continue;
    }
    if (role === 'assistant') {
      const assistantContent = getAssistantContent(message.content, toolResults);
      messages.push({
        assistantMessageId: id,
        content: assistantContent.contentBlocks
          .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
          .map(block => block.content)
          .join(''),
        ...(assistantContent.contentBlocks.length > 0 ? { contentBlocks: assistantContent.contentBlocks } : {}),
        id,
        role: 'assistant',
        timestamp,
        ...(assistantContent.toolCalls.length > 0 ? { toolCalls: assistantContent.toolCalls } : {}),
      });
    }
  }
  return messages;
}

export function findOmpSessionFileInRoot(sessionId: string, root: string): string | null {
  const trimmed = sessionId.trim();
  if (!trimmed || /[\\/]/u.test(trimmed)) return null;
  return findRecursively(root, trimmed);
}

function findRecursively(root: string, sessionId: string): string | null {
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const candidate = path.join(root, entry.name);
      if (entry.isDirectory()) {
        const found = findRecursively(candidate, sessionId);
        if (found) return found;
      } else if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.includes(sessionId)) {
        return candidate;
      }
    }
  } catch {
    return null;
  }
  return null;
}

interface OmpToolResult {
  content: string;
  isError: boolean;
  details?: unknown;
}

function getToolResults(entries: Record<string, unknown>[]): Map<string, OmpToolResult> {
  const results = new Map<string, OmpToolResult>();
  for (const entry of entries) {
    if (entry.type !== 'message' || !isRecord(entry.message)) continue;
    const message = entry.message;
    if (message.role !== 'toolResult' || typeof message.toolCallId !== 'string') continue;
    results.set(message.toolCallId, {
      content: getText(message.content),
      isError: message.isError === true,
      ...(message.details !== undefined ? { details: message.details } : {}),
    });
  }
  return results;
}

function getAssistantContent(
  value: unknown,
  toolResults: ReadonlyMap<string, OmpToolResult>,
): { contentBlocks: ContentBlock[]; toolCalls: ToolCallInfo[] } {
  const parts = Array.isArray(value) ? value : [];
  const blocks: ContentBlock[] = [];
  const toolCalls: ToolCallInfo[] = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.type === 'thinking') {
      const content = getText(part.thinking ?? part.text ?? part.content);
      if (content) blocks.push({ content, type: 'thinking' });
    } else if (part.type === 'text') {
      const content = getText(part.text ?? part.content);
      if (content) blocks.push({ content, type: 'text' });
    } else if (part.type === 'toolCall' && typeof part.id === 'string' && part.id) {
      const rawName = typeof part.name === 'string' ? part.name : 'tool';
      const rawInput = isRecord(part.arguments) ? part.arguments : {};
      const result = toolResults.get(part.id);
      blocks.push({ toolId: part.id, type: 'tool_use' });
      toolCalls.push({
        id: part.id,
        input: normalizeOmpToolInput(rawName, rawInput),
        name: normalizeOmpToolName(rawName),
        ...(result ? { result: result.content } : {}),
        status: result ? (result.isError ? 'error' : 'completed') : 'running',
        providerPayload: {
          rawName,
          rawInput,
          ...(result?.details !== undefined ? { rawOutput: result.details } : {}),
        },
      });
    }
  }
  return { contentBlocks: blocks, toolCalls };
}

function getText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(getText).join('');
  if (!isRecord(value)) return '';
  return typeof value.text === 'string'
    ? value.text
    : typeof value.content === 'string'
      ? value.content
      : '';
}

function getTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  return Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
