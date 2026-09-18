import {
  createSdkMcpServer,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { ObsidianWorkspaceAdapter } from '../../../core/obsidian/ObsidianWorkspaceAdapter';
import { executeObsidianWorkspaceTool } from '../../../core/obsidian/ObsidianWorkspaceTool';

export const CLAUDE_OBSIDIAN_MCP_SERVER_NAME = 'claudian_obsidian';
export const CLAUDE_OBSIDIAN_MCP_TOOL_NAME = `mcp__${CLAUDE_OBSIDIAN_MCP_SERVER_NAME}__workspace`;

const inputSchema = {
  operation: z.enum(['read', 'search', 'set-property', 'move', 'trash', 'backlinks']),
  path: z.string().optional(),
  query: z.string().optional(),
  name: z.string().optional(),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.null(),
  ]).optional(),
  destination: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
};

export function createClaudeObsidianWorkspaceMcpServer(
  adapter: ObsidianWorkspaceAdapter,
) {
  return createSdkMcpServer({
    name: CLAUDE_OBSIDIAN_MCP_SERVER_NAME,
    version: '1.0.0',
    tools: [
      tool(
        'workspace',
        'Read, search, inspect backlinks, update properties, move, or trash files in the currently open Obsidian vault. Use vault-relative paths. Ask for confirmation before destructive operations when the user has not explicitly requested them.',
        inputSchema,
        async (input) => {
          const result = await executeObsidianWorkspaceTool(adapter, input);
          return {
            content: [{ type: 'text' as const, text: result.text }],
            isError: !result.success,
          };
        },
      ),
    ],
  });
}
