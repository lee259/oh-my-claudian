import {
  OBSIDIAN_WORKSPACE_TOOL_DESCRIPTION,
  OBSIDIAN_WORKSPACE_TOOL_JSON_SCHEMA,
} from '@/core/obsidian/ObsidianWorkspaceTool';

/** Native tool adapter. Only Node built-ins and the documented tools registration contract are needed. */
export const DEEPSEEK_OBSIDIAN_TOOLS_SOURCE = `
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'claudian-obsidian';
export const inject = ['tools'];
export function apply(ctx, config) {
  if (typeof config?.connectionDirectory !== 'string' || !config.connectionDirectory) {
    throw new TypeError('Obsidian tools require a session connection directory.');
  }
  ctx.tools.register({
    name: 'obsidian_vault',
    description: ${JSON.stringify(OBSIDIAN_WORKSPACE_TOOL_DESCRIPTION)},
    parameters: ${JSON.stringify(OBSIDIAN_WORKSPACE_TOOL_JSON_SCHEMA)},
    output: {
      schema: { type: 'object', properties: { content: { type: 'array', items: { type: 'object' } } }, required: ['content'] },
      render: (_args, result) => result.content,
    },
    isConcurrencySafe: args => args.operation === 'backlinks',
    async execute(args, exec) {
      const id = exec.agent?.session?.id;
      let connection;
      try {
        if (typeof id !== 'string') throw new Error();
        connection = JSON.parse(readFileSync(join(config.connectionDirectory, createHash('sha256').update(id).digest('hex') + '.json'), 'utf8'));
      } catch { throw new Error('This DeepSeek session is not authorized to use Obsidian tools.'); }
      const endpoint = new URL(connection.endpoint);
      if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.pathname !== '/mcp'
        || typeof connection.token !== 'string' || !connection.token) throw new Error('Invalid Obsidian connection.');
      const response = await fetch(endpoint, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'vault', arguments: args } }),
        signal: AbortSignal.any([exec.signal, AbortSignal.timeout(30000)]),
      });
      if (!response.ok) throw new Error('Obsidian tool bridge rejected the request (' + response.status + ').');
      const text = await response.text();
      const payload = response.headers.get('content-type')?.includes('text/event-stream')
        ? JSON.parse(text.split('\\n').find(line => line.startsWith('data: '))?.slice(6) ?? 'null')
        : JSON.parse(text);
      if (payload?.error || !Array.isArray(payload?.result?.content)) throw new Error('Invalid Obsidian tool response.');
      if (payload.result.isError) throw new Error(payload.result.content.filter(item => item.type === 'text').map(item => item.text).join('\\n') || 'Obsidian operation failed.');
      return payload.result;
    },
  });
}
`;
