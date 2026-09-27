import { mergePersistedProviderState } from '../../../core/providers/providerState';
import type {
  ProviderConversationHistoryService,
  ProviderHistoryPathContext,
} from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { OpencodeCliResolver } from '../runtime/OpencodeCliResolver';
import { buildOpencodeRuntimeEnv } from '../runtime/OpencodeRuntimeEnvironment';
import { getOpencodeState, type OpencodeProviderState } from '../types';
import { resolveOpencodeDatabasePathHint } from './OpencodeHistoryPathResolver';
import {
  isOpencodeSessionHydrationDiagnosticMessage,
  loadOpencodeSessionMessages,
  loadOpencodeSessionModel,
} from './OpencodeHistoryStore';
import { forkOpencodeSession } from './OpencodeSessionFork';

const OPENCODE_PROVIDER_STATE_KEYS = [
  'sessionId',
  'nativeVersion',
  'databasePath',
  'nativeConversationContextEstablished',
] as const;

export class OpencodeConversationHistoryService implements ProviderConversationHistoryService {
  private hydratedKeys = new Map<string, string>();

  constructor(
    private readonly forkSession: typeof forkOpencodeSession = forkOpencodeSession,
  ) {}

  hasConversationModelRecoverySource(conversation: Conversation): boolean {
    return !!(conversation.sessionId ?? getOpencodeState(conversation.providerState).sessionId);
  }

  async recoverConversationModelSelection(
    conversation: Conversation,
    _vaultPath: string | null,
    pathContext?: ProviderHistoryPathContext,
  ): Promise<string | null> {
    const state = getOpencodeState(conversation.providerState);
    const sessionId = conversation.sessionId ?? state.sessionId;
    if (!sessionId) return null;
    const databasePath = resolveOpencodeDatabasePathHint(state.databasePath, pathContext);
    if (!databasePath) return null;
    return loadOpencodeSessionModel(sessionId, {
      databasePath,
      nativeVersion: state.nativeVersion,
    }, pathContext?.environment);
  }

  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
    pathContext?: ProviderHistoryPathContext,
  ): Promise<void> {
    const state = getOpencodeState(conversation.providerState);
    const databasePath = resolveOpencodeDatabasePathHint(state.databasePath, pathContext);
    if (state.databasePath && state.databasePath !== databasePath) {
      const providerState = { ...conversation.providerState };
      if (databasePath) {
        providerState.databasePath = databasePath;
      } else {
        delete providerState.databasePath;
      }
      conversation.providerState = Object.keys(providerState).length > 0
        ? providerState
        : undefined;
    }
    const sessionId = conversation.sessionId ?? state.sessionId ?? null;
    if (!sessionId) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    const hydrationKey = `${sessionId}::${databasePath ?? ''}`;
    if (
      conversation.messages.length > 0
      && this.hydratedKeys.get(conversation.id) === hydrationKey
    ) {
      this.markNativeConversationContextEstablished(conversation);
      return;
    }

    const messages = await loadOpencodeSessionMessages(
      sessionId,
      {
        databasePath: databasePath ?? undefined,
        nativeVersion: state.nativeVersion,
      },
      pathContext?.environment,
    );
    if (messages.length === 0) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    conversation.messages = messages;
    if (
      messages.length === 1
      && isOpencodeSessionHydrationDiagnosticMessage(messages[0])
    ) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    this.hydratedKeys.set(conversation.id, hydrationKey);
    this.markNativeConversationContextEstablished(conversation);
  }

  async resolveMissingConversationSession(
    conversation: Conversation,
    _vaultPath: string | null,
    missingProviderSessionId?: string,
  ): Promise<'delete' | 'reset' | 'preserve'> {
    if (
      !(conversation.sessionId ?? getOpencodeState(conversation.providerState).sessionId)
      || !missingProviderSessionId
      || (conversation.sessionId ?? getOpencodeState(conversation.providerState).sessionId) !== missingProviderSessionId
    ) {
      return 'preserve';
    }

    conversation.sessionId = null;
    const providerState = { ...conversation.providerState };
    delete providerState.sessionId;
    conversation.providerState = {
      ...providerState,
      nativeConversationContextEstablished: false,
    };
    this.hydratedKeys.delete(conversation.id);
    return 'reset';
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return conversation?.sessionId ?? getOpencodeState(conversation?.providerState).sessionId ?? null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  async buildForkProviderState(
    sourceSessionId: string,
    _resumeAt: string,
    sourceProviderState?: Record<string, unknown>,
    vaultPath?: string | null,
    pathContext?: ProviderHistoryPathContext,
  ): Promise<Record<string, unknown>> {
    const cwd = vaultPath ?? pathContext?.vaultPath;
    if (!cwd) throw new Error('OpenCode fork requires a workspace directory.');
    const source = getOpencodeState(sourceProviderState);
    const databasePath = resolveOpencodeDatabasePathHint(source.databasePath, pathContext);
    if (!databasePath || databasePath === ':memory:') {
      throw new Error('OpenCode fork requires a persistent native database.');
    }
    const settings = pathContext?.settings ?? {};
    const cliPath = new OpencodeCliResolver().resolveFromSettings(settings) ?? 'opencode';
    const environment = {
      ...buildOpencodeRuntimeEnv(settings, cliPath, databasePath),
      ...pathContext?.environment,
      OPENCODE_DB: databasePath,
    };
    let nativeVersion = source.nativeVersion;
    const sessionId = await this.forkSession({
      cliPath,
      cwd,
      environment,
      nativeVersion,
      sourceSessionId,
      onNativeVersion: version => { nativeVersion = version ?? nativeVersion; },
    });
    return {
      sessionId,
      databasePath,
      ...(nativeVersion ? { nativeVersion } : {}),
      nativeConversationContextEstablished: true,
    };
  }

  buildPersistedProviderState(
    conversation: Conversation,
  ): Record<string, unknown> | undefined {
    const state = getOpencodeState(conversation.providerState);
    const providerState: OpencodeProviderState = {
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
      ...(state.nativeVersion ? { nativeVersion: state.nativeVersion } : {}),
      ...(state.databasePath ? { databasePath: state.databasePath } : {}),
      ...(typeof state.nativeConversationContextEstablished === 'boolean'
        ? {
            nativeConversationContextEstablished:
              state.nativeConversationContextEstablished,
          }
        : {}),
    };

    return mergePersistedProviderState(
      conversation.providerState,
      OPENCODE_PROVIDER_STATE_KEYS,
      providerState,
    );
  }

  private markNativeConversationContextEstablished(
    conversation: Conversation,
  ): void {
    const state = getOpencodeState(conversation.providerState);
    if (state.nativeConversationContextEstablished !== false) return;
    conversation.providerState = {
      ...conversation.providerState,
      nativeConversationContextEstablished: true,
    };
  }
}
