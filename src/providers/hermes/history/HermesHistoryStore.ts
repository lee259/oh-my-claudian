import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ManagedCommandRunner } from '@/core/process/ManagedCommandRunner';
import type { ProviderHistoryPathContext } from '@/core/providers/types';
import type { ChatMessage, ContentBlock, ImageAttachment, ToolCallInfo } from '@/core/types';

type Row = Record<string, unknown>;
interface SqliteModule {
  DatabaseSync: new (location: string, options: { readOnly: boolean }) => {
    close(): void;
    prepare(sql: string): { all(...args: string[]): Row[] };
  };
}
const QUERY = 'SELECT id, role, hex(content) AS contentHex, tool_call_id, tool_calls, tool_name, timestamp, reasoning, reasoning_content FROM messages WHERE session_id = ? AND active = 1 ORDER BY id';

export async function loadHermesSessionMessages(sessionId: string, context?: ProviderHistoryPathContext): Promise<ChatMessage[]> {
  if (!/^[A-Za-z0-9_-]+$/u.test(sessionId)) throw new Error('Invalid Hermes session ID');
  const database = path.join(resolveHermesHome(context), 'state.db');
  if (!fs.existsSync(database)) throw new Error('Hermes history database was not found');
  let rows: Row[] | null = null;
  try {
    const sqlite = typeof module.require === 'function' ? module.require('node:sqlite') as SqliteModule : null;
    if (sqlite?.DatabaseSync) {
      const db = new sqlite.DatabaseSync(database, { readOnly: true });
      try { rows = db.prepare(QUERY).all(sessionId); } finally { db.close(); }
    }
  } catch { /* Fall back to the system sqlite3 reader. */ }
  if (!rows) {
    const query = QUERY.replace('?', `'${sessionId}'`);
    const result = await new ManagedCommandRunner().run({ command: 'sqlite3', args: ['-readonly', '-json', database, query],
      cwd: context?.vaultPath || process.cwd(), env: context?.environment ?? process.env, stdoutLimitBytes: 100 * 1024 * 1024, timeoutMs: 10000 });
    if (result.exitCode !== 0 || result.termination) throw new Error('Could not read Hermes history database');
    try { rows = result.stdout.trim() ? JSON.parse(result.stdout) as Row[] : []; }
    catch { throw new Error('Could not decode Hermes history database'); }
  }
  if (!Array.isArray(rows)) throw new Error('Invalid Hermes history database response');
  return projectHermesHistory(rows, sessionId);
}

export function resolveHermesHome(context?: ProviderHistoryPathContext): string {
  const env = context?.environment ?? process.env;
  const userHome = env.HOME?.trim() || env.USERPROFILE?.trim() || os.homedir();
  const defaultRoot = context?.hostPlatform === 'win32'
    ? path.join(env.LOCALAPPDATA?.trim() || path.join(userHome, 'AppData', 'Local'), 'hermes')
    : path.join(userHome, '.hermes');
  const root = env.HERMES_HOME?.trim() || defaultRoot;
  if (path.basename(path.dirname(root)) === 'profiles' || env.HERMES_S6_SUPERVISED_CHILD) return root;
  try {
    const profile = fs.readFileSync(path.join(root, 'active_profile'), 'utf8').trim();
    if (profile && profile !== 'default' && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(profile)) return path.join(root, 'profiles', profile);
  } catch { /* Default profile. */ }
  return root;
}

export function projectHermesHistory(rows: Row[], sessionId: string): ChatMessage[] {
  const results = new Map<string, string>();
  for (const row of rows) if (row.role === 'tool' && typeof row.tool_call_id === 'string') results.set(row.tool_call_id, contentText(row));
  const messages: ChatMessage[] = [];
  for (const row of rows) {
    if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.id !== 'number') continue;
    const id = `${sessionId}-${row.role}-${row.id}`;
    const timestamp = typeof row.timestamp === 'number' && Number.isFinite(row.timestamp) ? Math.round(row.timestamp * 1000) : 0;
    const content = contentText(row);
    if (row.role === 'user') {
      const images = contentImages(row, id);
      messages.push({ id, userMessageId: id, role: 'user', content, timestamp, ...(images.length ? { images } : {}) });
      continue;
    }
    const blocks: ContentBlock[] = [];
    const reasoning = typeof row.reasoning_content === 'string' && row.reasoning_content ? row.reasoning_content : row.reasoning;
    if (typeof reasoning === 'string' && reasoning) blocks.push({ type: 'thinking', content: reasoning });
    if (content) blocks.push({ type: 'text', content });
    const calls: ToolCallInfo[] = [];
    for (const item of parseArray(row.tool_calls)) {
      if (!isRecord(item) || typeof item.id !== 'string' || !item.id || !isRecord(item.function)) continue;
      const name = typeof item.function.name === 'string' ? item.function.name : 'tool';
      const rawInput = parseObject(item.function.arguments);
      const result = results.get(item.id);
      blocks.push({ type: 'tool_use', toolId: item.id });
      const presentation = hermesHistoryToolPresentation(name, rawInput);
      calls.push({ id: item.id, name, input: rawInput, status: 'unknown',
        ...(presentation ? { presentation } : {}),
        ...(result !== undefined ? { result } : {}), providerPayload: { rawName: name, rawInput } });
    }
    if (blocks.length) messages.push({ id, assistantMessageId: id, role: 'assistant', content, timestamp, contentBlocks: blocks, ...(calls.length ? { toolCalls: calls } : {}) });
  }
  return messages;
}
function decodedContent(row: Row): unknown {
  let value = typeof row.contentHex === 'string' ? Buffer.from(row.contentHex, 'hex').toString('utf8') : row.content;
  if (typeof value === 'string' && value.startsWith('\0json:')) { try { value = JSON.parse(value.slice(6)) as unknown; } catch { return ''; } }
  return value;
}
function contentText(row: Row): string {
  const value = decodedContent(row);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(part => isRecord(part) && typeof part.text === 'string' ? part.text : '').join('');
  return '';
}
function contentImages(row: Row, messageId: string): ImageAttachment[] {
  const value = decodedContent(row);
  if (!Array.isArray(value)) return [];
  const images: ImageAttachment[] = [];
  for (const part of value) {
    if (!isRecord(part) || part.type !== 'image_url') continue;
    const url = isRecord(part.image_url) ? part.image_url.url : part.image_url;
    if (typeof url !== 'string') continue;
    const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(url);
    if (!match) continue;
    const mediaType = match[1] as ImageAttachment['mediaType'];
    images.push({ id: `${messageId}-image-${images.length}`, name: `image-${images.length + 1}`, mediaType,
      data: match[2], size: Buffer.from(match[2], 'base64').length, source: 'paste' });
  }
  return images;
}
function parseArray(value: unknown): unknown[] {
  if (typeof value === 'string') { try { value = JSON.parse(value) as unknown; } catch { return []; } }
  return Array.isArray(value) ? value : [];
}
function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { value = JSON.parse(value) as unknown; } catch { return { raw: value }; } }
  return isRecord(value) ? value : {};
}
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

function hermesHistoryToolPresentation(name: string, input: Record<string, unknown>): ToolCallInfo['presentation'] | undefined {
  const labels: Record<string, string> = { read_file: 'read', write_file: 'write', search_files: 'search', terminal: 'terminal' };
  const label = labels[name];
  if (!label) return undefined;
  const value = name === 'terminal' ? input.command : name === 'search_files' ? input.pattern : input.path;
  return { name: label, ...(typeof value === 'string' && value.trim() ? { summary: value.trim() } : {}) };
}
