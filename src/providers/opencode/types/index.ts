import * as path from 'node:path';

export interface OpencodeHistorySource {
  sessionId: string;
  databasePath?: string;
  nativeVersion?: 1 | 2;
}

export interface OpencodeProviderState extends Record<string, unknown> {
  databasePath?: string;
  historySources?: OpencodeHistorySource[];
  nativeConversationContextEstablished?: boolean;
  nativeVersion?: 1 | 2;
  sessionId?: string;
}

export function getOpencodeState(
  providerState?: unknown,
): OpencodeProviderState {
  if (
    providerState === null
    || typeof providerState !== 'object'
    || Array.isArray(providerState)
  ) {
    return {};
  }

  const record = providerState as Record<string, unknown>;
  const parsed = Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) => (
        key !== 'historySources'
        && key !== 'databasePath'
        && key !== 'nativeConversationContextEstablished'
        && key !== 'nativeVersion'
        && key !== 'sessionId'
        && value !== undefined
      ),
    ),
  ) as OpencodeProviderState;
  const databasePath = typeof record.databasePath === 'string'
    ? record.databasePath.trim()
    : '';
  if (databasePath) parsed.databasePath = databasePath;
  if (typeof record.nativeConversationContextEstablished === 'boolean') {
    parsed.nativeConversationContextEstablished =
      record.nativeConversationContextEstablished;
  }
  if (record.nativeVersion === 1 || record.nativeVersion === 2) {
    parsed.nativeVersion = record.nativeVersion;
  }
  if (typeof record.sessionId === 'string' && record.sessionId.trim()) {
    parsed.sessionId = record.sessionId.trim();
  }
  if (Array.isArray(record.historySources)) {
    parsed.historySources = normalizeOpencodeHistorySources(record.historySources);
  }
  return parsed;
}


/** Invalid source metadata must not turn into apparently complete, shorter history. */
export function hasMalformedOpencodeHistorySources(providerState: unknown): boolean {
  if (!providerState || typeof providerState !== 'object' || Array.isArray(providerState)) return false;
  const raw = (providerState as Record<string, unknown>).historySources;
  if (raw === undefined) return false;
  if (!Array.isArray(raw)) return true;
  return raw.some(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
    const source = value as Record<string, unknown>;
    return typeof source.sessionId !== 'string' || !source.sessionId.trim()
      || (source.databasePath !== undefined && (typeof source.databasePath !== 'string' || !source.databasePath.trim()))
      || (source.nativeVersion !== undefined && source.nativeVersion !== 1 && source.nativeVersion !== 2);
  });
}

export function normalizeOpencodeHistorySources(values: readonly unknown[]): OpencodeHistorySource[] {
  const sources: OpencodeHistorySource[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const raw = value as Record<string, unknown>;
    if (typeof raw.sessionId !== 'string' || !raw.sessionId.trim()) continue;
    const databasePath = typeof raw.databasePath === 'string' ? raw.databasePath.trim() : '';
    const source: OpencodeHistorySource = {
      sessionId: raw.sessionId.trim(),
      ...(databasePath ? { databasePath } : {}),
      ...(raw.nativeVersion === 1 || raw.nativeVersion === 2 ? { nativeVersion: raw.nativeVersion } : {}),
    };
    const key = JSON.stringify([databasePath ? path.normalize(databasePath) : null, source.nativeVersion, source.sessionId]);
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  return sources;
}

/** Retires only execution fields; historical locators never become resume seeds. */
export function retireOpencodeSession(
  providerState: unknown,
  sessionId: string | null,
): Record<string, unknown> {
  const state = getOpencodeState(providerState);
  const nativeId = sessionId ?? state.sessionId;
  const liveSource = nativeId ? {
    sessionId: nativeId,
    ...(state.databasePath ? { databasePath: state.databasePath } : {}),
    ...(state.nativeVersion ? { nativeVersion: state.nativeVersion } : {}),
  } : null;
  const historySources = normalizeOpencodeHistorySources([
    ...(state.historySources ?? []), ...(liveSource ? [liveSource] : []),
  ]);
  delete state.sessionId;
  delete state.databasePath;
  delete state.nativeVersion;
  return {
    ...state,
    historySources: hasMalformedOpencodeHistorySources(providerState)
      ? [
        ...(Array.isArray((providerState as Record<string, unknown>).historySources)
          ? (providerState as { historySources: unknown[] }).historySources
          : [{ unrecognizedHistorySources: (providerState as Record<string, unknown>).historySources }]),
        ...(liveSource ? [liveSource] : []),
      ]
      : historySources,
    nativeConversationContextEstablished: false,
  };
}
