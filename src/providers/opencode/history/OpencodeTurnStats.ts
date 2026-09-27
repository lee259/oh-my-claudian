import { createTurnStats, isTokenCount, type TurnStats } from '../../../core/types';
import { resolveExistingOpencodeDatabasePath } from '../runtime/OpencodePaths';
import type { OpencodeProviderState } from '../types';
import { loadOpencodeSessionRows, type StoredRow } from './OpencodeSqliteReader';

/** Aggregates native OpenCode assistant usage for one user turn. */
export class OpencodeTurnStats {
  private userId: string | undefined;
  private startedAt: number | null = null;
  private outputTokens: number | undefined = 0;

  reset(): void {
    this.userId = undefined;
    this.startedAt = null;
    this.outputTokens = 0;
  }

  add(info: StoredRow): TurnStats | undefined {
    if (info.role === 'user') {
      this.reset();
      this.userId = typeof info.id === 'string' ? info.id : undefined;
      this.startedAt = getCreatedAt(info);
      return undefined;
    }
    if (info.role !== 'assistant' || info.data_valid === 0) {
      this.reset();
      return undefined;
    }
    const tokens = asRecord(info.tokens);
    const output = tokens?.output;
    const reasoning = tokens?.reasoning;
    if (!isTokenCount(output) || !isTokenCount(reasoning)
      || info.parentID !== this.userId) {
      this.outputTokens = undefined;
    } else if (this.outputTokens !== undefined) {
      this.outputTokens += output + reasoning;
    }
    const completedAt = getCompletedAt(info);
    return (info.finish === 'stop' || info.finish === 'length' || info.finish === 'error')
      && this.startedAt !== null && completedAt !== null
      ? createTurnStats(this.outputTokens, completedAt - this.startedAt)
      : undefined;
  }
}

export async function loadOpencodeTurnStats(
  sessionId: string,
  state: OpencodeProviderState,
  selector: { userMessageId?: string | null; startedAt: number },
  environment: NodeJS.ProcessEnv = process.env,
): Promise<TurnStats | undefined> {
  const databasePath = resolveExistingOpencodeDatabasePath(state.databasePath, environment);
  if (!databasePath || databasePath === ':memory:') return undefined;
  const rows = await loadOpencodeSessionRows(databasePath, sessionId, {
    environment,
    nativeVersion: state.nativeVersion === 2 ? 2 : 'auto',
  });
  const messages: StoredRow[] = rows.nativeVersion === 2
    ? rows.messageRows.flatMap((row): StoredRow[] => {
        const data = parseObject(row.data);
        return data ? [{ ...data, id: row.id, role: row.type, time_created: row.time_created }] : [];
      })
    : rows.messageRows;
  let startIndex = selector.userMessageId
    ? messages.findIndex(row => row.id === selector.userMessageId)
    : -1;
  if (startIndex < 0) {
    startIndex = messages.findIndex(row => row.role === 'user'
      && (typeof row.time_created === 'number' ? row.time_created : Number(row.time_created)) >= selector.startedAt);
  }
  if (startIndex < 0 || messages[startIndex]?.role !== 'user') return undefined;

  const stats = new OpencodeTurnStats();
  let result: TurnStats | undefined;
  for (const row of messages.slice(startIndex)) {
    if (row.role === 'user' && row.id !== messages[startIndex]?.id) break;
    if (row.data_valid === 0) {
      stats.reset();
      result = undefined;
      continue;
    }
    if (row.role !== 'user' && row.role !== 'assistant') {
      if (rows.nativeVersion === 2) return result;
      continue;
    }
    result = stats.add({
      ...row,
      // OpenCode v2 stores messages in sequence and omits parentID. The slice is
      // already bounded by the selected user message and the next user message.
      parentID: rows.nativeVersion === 2
        ? messages[startIndex]?.id
        : row.parent_id ?? row.parentID,
      tokens: {
        output: row.output_tokens ?? asRecord(row.tokens)?.output,
        reasoning: row.reasoning_tokens ?? asRecord(row.tokens)?.reasoning,
      },
    });
  }
  return result;
}

export function getMessageCreatedAt(info: StoredRow): number | null {
  return asNumber(asRecord(info.time)?.created)
    ?? asNumber(info.data_time_created)
    ?? asNumber(info.time_created);
}

export function getMessageCompletedAt(info: StoredRow): number | null {
  return asNumber(asRecord(info.time)?.completed) ?? asNumber(info.data_time_completed);
}

function getCreatedAt(info: StoredRow): number | null {
  return getMessageCreatedAt(info);
}

function getCompletedAt(info: StoredRow): number | null {
  return getMessageCompletedAt(info);
}

function asRecord(value: unknown): StoredRow | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as StoredRow
    : undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseObject(value: unknown): StoredRow | undefined {
  if (typeof value !== 'string') return asRecord(value);
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}
