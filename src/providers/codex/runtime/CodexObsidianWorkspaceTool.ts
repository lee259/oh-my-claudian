import type { ObsidianWorkspaceAdapter } from '../../../core/obsidian/ObsidianWorkspaceAdapter';
import {
  executeObsidianWorkspaceTool,
  OBSIDIAN_VAULT_TOOL_NAME,
  OBSIDIAN_VAULT_TOOL_NAMESPACE,
  OBSIDIAN_WORKSPACE_TOOL_DESCRIPTION,
  OBSIDIAN_WORKSPACE_TOOL_JSON_SCHEMA,
} from '../../../core/obsidian/ObsidianWorkspaceTool';
import type { CodexDynamicToolRegistration } from './CodexDynamicToolRegistry';

export function createCodexObsidianWorkspaceTool(
  adapter: ObsidianWorkspaceAdapter,
): CodexDynamicToolRegistration {
  return {
    includeInThreadStart: true,
    namespace: {
      name: OBSIDIAN_VAULT_TOOL_NAMESPACE,
      description: 'Tools for interacting with the currently open Obsidian vault.',
    },
    tool: {
      type: 'function',
      name: OBSIDIAN_VAULT_TOOL_NAME,
      description: OBSIDIAN_WORKSPACE_TOOL_DESCRIPTION,
      inputSchema: OBSIDIAN_WORKSPACE_TOOL_JSON_SCHEMA,
    },
    handler: async (params) => {
      const result = await executeObsidianWorkspaceTool(adapter, params.arguments);
      return {
        success: result.success,
        contentItems: [{
          type: 'inputText',
          text: result.text,
        }],
      };
    },
  };
}
