import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import { mergePersistedProviderState } from '../../../core/providers/providerState';
import type {
  ProviderConversationHistoryService,
  ProviderHistoryPathContext,
} from '../../../core/providers/types';
import type { ChatMessage, Conversation, ToolCallInfo } from '../../../core/types';
import { OpencodeCliResolver } from '../runtime/OpencodeCliResolver';
import { buildOpencodeRuntimeEnv } from '../runtime/OpencodeRuntimeEnvironment';
import { getOpencodeState, hasMalformedOpencodeHistorySources, type OpencodeHistorySource, retireOpencodeSession } from '../types';
import { resolveOpencodeDatabasePathHint } from './OpencodeHistoryPathResolver';
import {
  createOpencodeHydrationDiagnosticMessage,
  isOpencodeHydrationDiagnosticMessage,
  loadOpencodeSessionMessages,
  loadOpencodeSessionModel,
} from './OpencodeHistoryStore';
import { forkOpencodeSession } from './OpencodeSessionFork';
import { hydrateOpenCodeV2Children } from './OpencodeSubagentHistory';

const OPENCODE_PROVIDER_STATE_KEYS = [
  'historySources',
  'sessionId',
  'nativeVersion',
  'databasePath',
  'nativeConversationContextEstablished',
] as const;

export class OpencodeConversationHistoryService implements ProviderConversationHistoryService {
  private hydratedKeys = new WeakMap<Conversation, string>();
  private nativeContexts = new WeakSet<Conversation>();

  constructor(
    private readonly forkSession: typeof forkOpencodeSession = forkOpencodeSession,
  ) {}

  hasConversationModelRecoverySource(conversation: Conversation): boolean {
    return getHistorySegments(conversation).length > 0;
  }

  needsConversationHistoryHydration(conversation: Conversation, options?: { projectionOnly?: boolean }): boolean {
    const incomplete = hasMalformedOpencodeHistorySources(conversation.providerState)
      || conversation.messages.some(isOpencodeHydrationDiagnosticMessage);
    if (options?.projectionOnly) return incomplete;
    const segments = getHistorySegments(conversation);
    return incomplete || segments.length > 0 && this.hydratedKeys.get(conversation) !== JSON.stringify(segments);
  }

  async recoverConversationModelSelection(
    conversation: Conversation,
    _vaultPath: string | null,
    pathContext?: ProviderHistoryPathContext,
  ): Promise<string | null> {
    if (hasMalformedOpencodeHistorySources(conversation.providerState)) return null;
    const source = getHistorySegments(conversation).at(-1);
    if (!source || (source.retired && !source.databasePath)) return null;
    const databasePath = resolveOpencodeDatabasePathHint(source.databasePath, pathContext);
    if (!databasePath) return null;
    return loadOpencodeSessionModel(source.sessionId, {
      databasePath,
      nativeVersion: source.nativeVersion,
    }, pathContext?.environment);
  }

  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
    pathContext?: ProviderHistoryPathContext,
  ): Promise<void> {
    if (hasMalformedOpencodeHistorySources(conversation.providerState)) {
      conversation.messages = [createOpencodeHydrationDiagnosticMessage({
        reason: 'The recorded OpenCode history sources are malformed.',
      })];
      this.hydratedKeys.delete(conversation);
      return;
    }
    const segments = getHistorySegments(conversation);
    if (!segments.length) {
      // A path without a native identity is launch configuration, not historical provenance.
      const state = getOpencodeState(conversation.providerState);
      if (state.databasePath && !resolveOpencodeDatabasePathHint(state.databasePath, pathContext)) {
        const providerState = { ...conversation.providerState };
        const currentPath = resolveOpencodeDatabasePathHint(undefined, pathContext);
        if (currentPath) providerState.databasePath = currentPath;
        else delete providerState.databasePath;
        conversation.providerState = providerState;
      }
      this.hydratedKeys.delete(conversation);
      return;
    }
    const hydrationKey = JSON.stringify(segments);
    if (conversation.messages.length > 0 && this.hydratedKeys.get(conversation) === hydrationKey
      && !conversation.messages.some(isOpencodeHydrationDiagnosticMessage)) {
      this.markNativeConversationContextEstablished(conversation);
      return;
    }
    const initialState = conversation.providerState;
    const initialSessionId = conversation.sessionId;
    const initialMessages = conversation.messages;
    const messages: ChatMessage[] = [];
    let liveContext = false;
    let resolvedLivePath: string | undefined;
    for (const source of segments) {
      const databasePath = source.retired && !source.databasePath
        ? null : resolveOpencodeDatabasePathHint(source.databasePath, pathContext);
      const segment = databasePath
        ? await loadOpencodeSessionMessages(source.sessionId, { ...source, databasePath }, pathContext?.environment)
        : [createOpencodeHydrationDiagnosticMessage({
          sessionId: source.sessionId, databasePath: source.databasePath,
          reason: source.databasePath
            ? 'The recorded OpenCode database is outside the trusted locations.'
            : 'The original OpenCode database location is unknown.',
        })];
      if (source.nativeVersion === 2 && databasePath) {
        await hydrateOpenCodeV2Children(segment, databasePath, pathContext?.environment ?? process.env);
      }
      if (!source.retired && !segment.some(isOpencodeHydrationDiagnosticMessage)) {
        liveContext = segment.some(message => message.role === 'user');
        resolvedLivePath = databasePath ?? undefined;
      }
      messages.push(...(source.retired ? projectRetiredMessages(segment, source) : segment));
    }
    // Native reads can yield while a settings transition, new snapshot, or hydration supersedes us.
    if (conversation.providerState !== initialState || conversation.sessionId !== initialSessionId
      || conversation.messages !== initialMessages || JSON.stringify(getHistorySegments(conversation)) !== hydrationKey) return;
    conversation.messages = messages;
    if (messages.some(isOpencodeHydrationDiagnosticMessage)) {
      this.hydratedKeys.delete(conversation);
      return;
    }
    if (resolvedLivePath && !getOpencodeState(conversation.providerState).databasePath) {
      conversation.providerState = { ...conversation.providerState, databasePath: resolvedLivePath };
    }
    if (liveContext) this.nativeContexts.add(conversation);
    else this.nativeContexts.delete(conversation);
    this.hydratedKeys.set(conversation, JSON.stringify(getHistorySegments(conversation)));
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

    conversation.providerState = retireOpencodeSession(conversation.providerState, conversation.sessionId);
    conversation.sessionId = null;
    conversation.messages = conversation.messages.map(message => ({ ...message, assistantMessageId: undefined }));
    this.hydratedKeys.delete(conversation);
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
    if (hasMalformedOpencodeHistorySources(sourceProviderState)) {
      throw new Error('OpenCode history sources are malformed.');
    }
    const source = getOpencodeState(sourceProviderState);
    const databasePath = resolveOpencodeDatabasePathHint(source.databasePath, pathContext);
    if (!databasePath || databasePath === ':memory:' || !existsSync(databasePath)) {
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
      resumeAt: _resumeAt,
      onNativeVersion: version => { nativeVersion = version ?? nativeVersion; },
    });
    return {
      ...source,
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
    const providerState: Record<string, unknown> = {
      ...(hasMalformedOpencodeHistorySources(conversation.providerState)
        ? { historySources: conversation.providerState?.historySources }
        : state.historySources ? { historySources: state.historySources } : {}),
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
    if (!this.nativeContexts.has(conversation) || !this.resolveSessionIdForConversation(conversation)
      || state.nativeConversationContextEstablished !== false) return;
    conversation.providerState = {
      ...conversation.providerState,
      nativeConversationContextEstablished: true,
    };
  }
}


interface HistorySegment extends OpencodeHistorySource {
  retired: boolean;
}

function sourceKey(source: OpencodeHistorySource): string {
  return JSON.stringify([source.databasePath ? path.normalize(source.databasePath) : undefined, source.nativeVersion, source.sessionId]);
}

function getHistorySegments(conversation: Conversation): HistorySegment[] {
  const state = getOpencodeState(conversation.providerState);
  const sessionId = conversation.sessionId ?? state.sessionId;
  const live = sessionId ? {
    sessionId, databasePath: state.databasePath, nativeVersion: state.nativeVersion, retired: false,
  } : null;
  return [
    ...(state.historySources ?? [])
      .filter(source => !live || sourceKey(source) !== sourceKey(live))
      .map(source => ({ ...source, retired: true })),
    ...(live ? [live] : []),
  ];
}

function projectRetiredMessages(messages: ChatMessage[], source: OpencodeHistorySource): ChatMessage[] {
  const namespace = `opencode-history-${createHash('sha256').update(sourceKey(source)).digest('hex').slice(0, 24)}-`;
  return messages.map(message => ({
    ...message,
    id: isOpencodeHydrationDiagnosticMessage(message) ? message.id + namespace : namespace + message.id,
    assistantMessageId: undefined,
    toolCalls: message.toolCalls?.map(tool => projectRetiredTool(tool, namespace)),
    contentBlocks: message.contentBlocks?.map(block => block.type === 'tool_use'
      ? { ...block, toolId: namespace + block.toolId } : block),
  }));
}


function projectRetiredTool(tool: ToolCallInfo, namespace: string): ToolCallInfo {
  return {
    ...tool,
    id: namespace + tool.id,
    ...(tool.subagent ? { subagent: {
      ...tool.subagent,
      id: namespace + tool.subagent.id,
      toolCalls: tool.subagent.toolCalls.map(child => projectRetiredTool(child, namespace)),
    } } : {}),
  };
}
