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

export function getCodexState(
  providerState?: Record<string, unknown>,
): CodexProviderState {
  return (providerState ?? {});
}
