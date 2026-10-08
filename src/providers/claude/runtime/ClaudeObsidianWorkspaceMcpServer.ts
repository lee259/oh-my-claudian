import {
  createSdkMcpServer,
  tool,
} from '@anthropic-ai/claude-agent-sdk/core';

import type { ObsidianWorkspaceAdapter } from '../../../core/obsidian/ObsidianWorkspaceAdapter';
import {
  executeObsidianWorkspaceTool,
  OBSIDIAN_VAULT_TOOL_NAME,
  OBSIDIAN_WORKSPACE_MCP_SERVER_NAME,
  OBSIDIAN_WORKSPACE_MCP_TOOL_NAME,
  OBSIDIAN_WORKSPACE_TOOL_DESCRIPTION,
  OBSIDIAN_WORKSPACE_TOOL_INPUT_SCHEMA,
} from '../../../core/obsidian/ObsidianWorkspaceTool';

export const CLAUDE_OBSIDIAN_MCP_SERVER_NAME = OBSIDIAN_WORKSPACE_MCP_SERVER_NAME;
export const CLAUDE_OBSIDIAN_MCP_TOOL_NAME = OBSIDIAN_WORKSPACE_MCP_TOOL_NAME;

export function createClaudeObsidianWorkspaceMcpServer(
  adapter: ObsidianWorkspaceAdapter,
) {
  return createSdkMcpServer({
    name: CLAUDE_OBSIDIAN_MCP_SERVER_NAME,
    version: '1.0.0',
    tools: [
      tool(
        OBSIDIAN_VAULT_TOOL_NAME,
        OBSIDIAN_WORKSPACE_TOOL_DESCRIPTION,
        OBSIDIAN_WORKSPACE_TOOL_INPUT_SCHEMA,
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
