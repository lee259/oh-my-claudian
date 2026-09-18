import type { ObsidianWorkspaceAdapter } from '../../../core/obsidian/ObsidianWorkspaceAdapter';
import {
  executeObsidianWorkspaceTool,
  OBSIDIAN_VAULT_TOOL_NAME,
  OBSIDIAN_VAULT_TOOL_NAMESPACE,
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
      description: 'Inspect backlinks, update properties, move, or trash files in the currently open Obsidian vault. Use vault-relative paths. Ask for confirmation before destructive operations when the user has not explicitly requested them.',
      inputSchema: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['set-property', 'move', 'trash', 'backlinks'],
          },
          path: {
            type: 'string',
            description: 'Vault-relative file path; required for all operations.',
          },
          name: {
            type: 'string',
            description: 'Frontmatter property name; required for set-property.',
          },
          value: {
            description: 'Frontmatter value; use null to delete the property.',
            type: ['string', 'number', 'boolean', 'array', 'null'],
          },
          destination: {
            type: 'string',
            description: 'Vault-relative destination path; required for move.',
          },
        },
        required: ['operation'],
        additionalProperties: false,
      },
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
