export interface OpencodeProviderState extends Record<string, unknown> {
  databasePath?: string;
  nativeConversationContextEstablished?: boolean;
  nativeVersion?: 1 | 2;
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
        key !== 'databasePath'
        && key !== 'nativeConversationContextEstablished'
        && key !== 'nativeVersion'
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
  return parsed;
}
