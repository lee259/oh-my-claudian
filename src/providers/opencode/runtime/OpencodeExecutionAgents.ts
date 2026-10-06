import { OBSIDIAN_WORKSPACE_MCP_SERVER_NAME } from '@/core/obsidian/ObsidianWorkspaceTool';
import type { SystemPromptSettings } from '@/core/prompt/mainAgent';
import type { ProviderHost } from '@/core/providers/ProviderHost';

import type { OpencodeExecutionProfile } from '../execution/OpencodeSessionContract';
import type { OpencodeManagedAgentConfig } from './OpencodeLaunchArtifacts';

export const AUX_AGENT_IDS: Record<Exclude<OpencodeExecutionProfile, 'managed'>, string> = {
  passive: 'claudian-execution-passive',
  readonly: 'claudian-execution-readonly',
};

const READ_PERMISSION = Object.freeze({
  '*': 'allow',
  '*.env': 'deny',
  '*.env.*': 'deny',
  '*.env.example': 'allow',
});

export function buildAgentConfig(
  profile: Exclude<OpencodeExecutionProfile, 'managed'>,
  enableObsidianWorkspaceTool = false,
): OpencodeManagedAgentConfig {
  return profile === 'readonly'
    ? {
      definition: {
        description: 'Claudian read-only execution agent.',
        mode: 'primary',
        permission: {
          '*': 'deny',
          codesearch: 'allow',
          external_directory: 'deny',
          glob: 'allow',
          grep: 'allow',
          lsp: 'allow',
          read: READ_PERMISSION,
          webfetch: 'allow',
          websearch: 'allow',
          ...(enableObsidianWorkspaceTool ? { [`${OBSIDIAN_WORKSPACE_MCP_SERVER_NAME}_*`]: 'allow' } : {}),
        },
      },
      id: AUX_AGENT_IDS.readonly,
    }
    : {
      definition: {
        description: 'Claudian passive execution agent.',
        mode: 'primary',
        permission: {
          '*': 'deny',
          external_directory: 'deny',
          ...(enableObsidianWorkspaceTool ? { [`${OBSIDIAN_WORKSPACE_MCP_SERVER_NAME}_*`]: 'allow' } : {}),
        },
      },
      id: AUX_AGENT_IDS.passive,
    };
}


export function getSystemPromptSettings(
  plugin: ProviderHost,
  vaultPath: string,
): SystemPromptSettings {
  return {
    customPrompt: plugin.settings.systemPrompt,
    mediaFolder: plugin.settings.mediaFolder,
    userName: plugin.settings.userName,
    vaultPath,
  };
}
