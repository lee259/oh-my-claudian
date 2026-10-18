import * as os from 'node:os';
import * as path from 'node:path';

import type { ProviderConversationHistoryService, ProviderHistoryPathContext } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { findOmpSessionFileInRoot, readOmpSessionFile } from './OmpHistoryStore';

export class OmpConversationHistoryService implements ProviderConversationHistoryService {
  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
    context?: ProviderHistoryPathContext,
  ): Promise<void> {
    if (!conversation.sessionId || conversation.messages.length > 0) return;
    const sessionFile = resolveOmpSessionFile(conversation.sessionId, context);
    if (!sessionFile) return;
    const messages = await readOmpSessionFile(sessionFile);
    if (messages.length > 0) conversation.messages = messages;
  }

  resolveSessionIdForConversation(conversation: { sessionId: string | null } | null): string | null {
    return conversation?.sessionId ?? null;
  }

  isPendingForkConversation(): boolean {
    return false;
  }

  buildForkProviderState(sourceSessionId: string): Record<string, unknown> {
    return { sourceSessionId };
  }

  buildPersistedProviderState(conversation: { providerState?: Record<string, unknown> }): Record<string, unknown> | undefined {
    return conversation.providerState;
  }
}

function resolveOmpSessionFile(
  sessionId: string,
  context?: ProviderHistoryPathContext,
): string | null {
  for (const root of getSessionRoots(context)) {
    const sessionFile = findOmpSessionFileInRoot(sessionId, root);
    if (sessionFile) return sessionFile;
  }
  return null;
}

function getSessionRoots(context?: ProviderHistoryPathContext): string[] {
  const environment = context?.environment ?? {};
  const configDir = environment.PI_CONFIG_DIR?.trim() || path.join(
    environment.HOME?.trim() || environment.USERPROFILE?.trim() || os.homedir(),
    '.omp',
  );
  const profile = environment.OMP_PROFILE?.trim() || environment.PI_PROFILE?.trim();
  const agentDir = profile
    ? path.join(configDir, 'profiles', profile, 'agent')
    : path.join(configDir, 'agent');
  return [path.join(agentDir, 'sessions')];
}
