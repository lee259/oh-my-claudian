import type { ForkSource } from '../../../core/types/chat';

export interface CodexPendingForkTarget {
  threadId: string;
  sessionFilePath?: string;
}

/** Read-only replay locator. Never used to resume an execution binding. */
export interface CodexHistorySource {
  sessionId: string | null;
  providerState: Omit<CodexProviderState, 'historySources'>;
  resumeAtMessageId?: string;
}

export interface CodexProviderState {
  historySources?: CodexHistorySource[];
  threadId?: string;
  nativeConversationContextEstablished?: boolean;
  sessionFilePath?: string;
  transcriptRootPath?: string;
  forkSourceSessionFilePath?: string;
  forkSourceTranscriptRootPath?: string;
  forkSource?: ForkSource;
  pendingForkTarget?: CodexPendingForkTarget;
  workspaceDependencyToolVersion?: number;
}

interface LegacyCodexPreviousSegment {
  threadId?: unknown;
  sessionFilePath?: unknown;
  transcriptRootPath?: unknown;
  forkSource?: unknown;
  forkSourceSessionFilePath?: unknown;
  forkSourceTranscriptRootPath?: unknown;
}

function isForkSource(value: unknown): value is ForkSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return typeof source.sessionId === 'string' && typeof source.resumeAt === 'string';
}

function migratePreviousSegment(value: unknown): CodexHistorySource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const segment = value as LegacyCodexPreviousSegment;
  const providerState: Omit<CodexProviderState, 'historySources'> = {};
  if (typeof segment.threadId === 'string') providerState.threadId = segment.threadId;
  if (typeof segment.sessionFilePath === 'string') {
    providerState.sessionFilePath = segment.sessionFilePath;
  }
  if (typeof segment.transcriptRootPath === 'string') {
    providerState.transcriptRootPath = segment.transcriptRootPath;
  }
  if (isForkSource(segment.forkSource)) providerState.forkSource = segment.forkSource;
  if (typeof segment.forkSourceSessionFilePath === 'string') {
    providerState.forkSourceSessionFilePath = segment.forkSourceSessionFilePath;
  }
  if (typeof segment.forkSourceTranscriptRootPath === 'string') {
    providerState.forkSourceTranscriptRootPath = segment.forkSourceTranscriptRootPath;
  }

  if (Object.keys(providerState).length === 0) return null;
  return {
    sessionId: providerState.threadId ?? null,
    providerState,
  };
}

export function getCodexState(
  providerState?: Record<string, unknown>,
): CodexProviderState {
  if (!providerState || !Array.isArray(providerState.previousSegments)) {
    return providerState ?? {};
  }

  const { previousSegments, ...currentState } = providerState;
  const migratedSources = previousSegments
    .map(migratePreviousSegment)
    .filter((source): source is CodexHistorySource => source !== null);
  const historySources = Array.isArray(currentState.historySources)
    ? currentState.historySources as CodexHistorySource[]
    : [];

  return {
    ...currentState,
    ...(migratedSources.length > 0 || historySources.length > 0
      ? { historySources: [...migratedSources, ...historySources] }
      : {}),
  };
}
