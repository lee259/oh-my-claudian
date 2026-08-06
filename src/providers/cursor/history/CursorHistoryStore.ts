import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ProviderHistoryPathContext } from '@/core/providers/types';
import type { ChatMessage, ContentBlock } from '@/core/types';

interface StoredRow {
  rowid: number;
  data: Uint8Array;
}

interface SqliteModule {
  DatabaseSync: new (location: string, options?: Record<string, unknown>) => {
    close(): void;
    prepare(sql: string): { all(...params: unknown[]): StoredRow[] };
  };
}

export async function loadCursorSessionMessages(
  sessionId: string,
  context?: ProviderHistoryPathContext,
): Promise<ChatMessage[]> {
  const databasePath = resolveCursorSessionDatabase(sessionId, context);
  if (!databasePath) return [];

  const rows = readCursorRows(databasePath);
  if (!rows) return [];
  return rows.flatMap(row => parseCursorMessage(row, sessionId));
}

export function resolveCursorSessionDatabase(
  sessionId: string,
  context?: ProviderHistoryPathContext,
): string | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(sessionId)) return null;
  const environment = context?.environment ?? {};
  const home = environment.HOME?.trim()
    || environment.USERPROFILE?.trim()
    || os.homedir();
  const databasePath = path.join(home, '.cursor', 'acp-sessions', sessionId, 'store.db');
  return fs.existsSync(databasePath) ? databasePath : null;
}

function readCursorRows(databasePath: string): StoredRow[] | null {
  const sqlite = requireSqliteModule();
  if (!sqlite) return null;

  let database: InstanceType<SqliteModule['DatabaseSync']> | null = null;
  try {
    database = new sqlite.DatabaseSync(databasePath, { readonly: true });
    return database
      .prepare('SELECT rowid, data FROM blobs ORDER BY rowid')
      .all();
  } catch {
    return null;
  } finally {
    database?.close();
  }
}

function parseCursorMessage(row: StoredRow, sessionId: string): ChatMessage[] {
  const text = Buffer.from(row.data).toString('utf8');
  if (!text.startsWith('{')) return [];

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(value) || (value.role !== 'user' && value.role !== 'assistant')) return [];

  const content = value.content;
  if (value.role === 'user') {
    const userText = getText(content);
    if (!Array.isArray(content) || !userText) return [];
    const requestId = getNestedString(value, ['providerOptions', 'cursor', 'requestId']);
    const id = requestId ?? `${sessionId}-user-${row.rowid}`;
    return [{
      content: extractUserQuery(userText),
      id,
      role: 'user',
      timestamp: extractTimestamp(userText) ?? Date.now(),
      userMessageId: id,
    }];
  }

  const blocks = getAssistantContentBlocks(content);
  if (blocks.length === 0) return [];
  return [{
    assistantMessageId: `${sessionId}-assistant-${row.rowid}`,
    content: blocks
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.content)
      .join(''),
    contentBlocks: blocks,
    id: `${sessionId}-assistant-${row.rowid}`,
    role: 'assistant',
    timestamp: Date.now(),
  }];
}

function getAssistantContentBlocks(value: unknown): ContentBlock[] {
  if (!Array.isArray(value)) return [];
  const blocks: ContentBlock[] = [];
  for (const part of value) {
    if (!isRecord(part)) continue;
    const text = getText(part.text ?? part.content);
    if (!text) continue;
    if (part.type === 'reasoning' || part.type === 'thinking') {
      blocks.push({ content: text, type: 'thinking' });
    } else if (part.type === 'text') {
      blocks.push({ content: text, type: 'text' });
    }
  }
  return blocks;
}

function extractUserQuery(value: string): string {
  const match = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/u.exec(value);
  return match?.[1]?.trim() || value.trim();
}

function extractTimestamp(value: string): number | null {
  const match = /<timestamp>([^<]+)<\/timestamp>/u.exec(value);
  if (!match?.[1]) return null;
  const timestamp = Date.parse(match[1]);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getNestedString(value: unknown, pathParts: string[]): string | null {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!isRecord(current)) return null;
    current = current[part];
  }
  return typeof current === 'string' && current ? current : null;
}

function getText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(part => isRecord(part) ? getText(part.text ?? part.content) : '').join('');
  return isRecord(value) ? getText(value.text ?? value.content) : '';
}

function requireSqliteModule(): SqliteModule | null {
  try {
    if (typeof module === 'undefined' || typeof module.require !== 'function') return null;
    const sqlite = module.require('node:sqlite') as unknown;
    return isRecord(sqlite) && typeof sqlite.DatabaseSync === 'function'
      ? sqlite as unknown as SqliteModule
      : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
