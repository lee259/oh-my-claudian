import type { ProviderToolPolicy } from '../execution/ProviderExecutionRequest';
import type { ObsidianWorkspaceOperation } from './ObsidianWorkspaceAdapter';
import {
  OBSIDIAN_WORKSPACE_MCP_TOOL_NAME,
  OBSIDIAN_WORKSPACE_OPERATIONS,
} from './ObsidianWorkspaceTool';

export const OBSIDIAN_WORKSPACE_PROVIDER_TOOL_NAMES = [
  'claudian_obsidian_vault',
  'claudian_obsidian__vault',
  'obsidian_vault',
  'obsidian.vault',
  OBSIDIAN_WORKSPACE_MCP_TOOL_NAME,
] as const;
export { OBSIDIAN_WORKSPACE_OPERATIONS } from './ObsidianWorkspaceTool';

export interface ObsidianWorkspaceToolBridgeConnection {
  readonly endpoint: string;
  readonly token: string;
}

/** Session-scoped credentials for provider processes that cannot call Obsidian APIs in-process. */
export interface ObsidianWorkspaceToolBridge {
  createConnection(): Promise<ObsidianWorkspaceToolBridgeConnection>;
  setAllowedOperations(token: string, operations: readonly ObsidianWorkspaceOperation[]): void;
  releaseConnection(token: string): void;
}

export function resolveObsidianWorkspaceToolOperations(
  policy: ProviderToolPolicy,
): readonly ObsidianWorkspaceOperation[] {
  switch (policy.kind) {
    case 'provider-default':
    case 'unrestricted':
      return OBSIDIAN_WORKSPACE_OPERATIONS;
    case 'allow-list':
      return OBSIDIAN_WORKSPACE_PROVIDER_TOOL_NAMES.some(name => policy.names.includes(name))
        ? OBSIDIAN_WORKSPACE_OPERATIONS
        : [];
    case 'passive':
      return [];
    case 'read-only':
      return ['backlinks'];
  }
}
