import type { StreamChunk, SubagentProgress } from '../../../core/types';

export interface ClaudeAsyncSubagentCompletionEvent {
  type: 'async_subagent_completion';
  providerSessionId: string;
  taskId: string;
  toolUseId?: string;
  status: 'completed' | 'error';
  result?: string;
}

export interface ClaudeSubagentProgressEvent {
  type: 'subagent_progress';
  progress: SubagentProgress;
}

export interface SessionInitEvent {
  type: 'session_init';
  sessionId: string;
  agents?: string[];
  permissionMode?: string;
}

export interface ContextWindowEvent {
  type: 'context_window';
  contextWindow: number;
  /** Actual model served by the provider runtime, when known. */
  model?: string;
}

export interface ClaudePromptSuggestionEvent {
  type: 'prompt_suggestion';
  suggestion: string;
}

export type TransformEvent =
  | StreamChunk
  | SessionInitEvent
  | ContextWindowEvent
  | ClaudeAsyncSubagentCompletionEvent
  | ClaudeSubagentProgressEvent
  | ClaudePromptSuggestionEvent;
