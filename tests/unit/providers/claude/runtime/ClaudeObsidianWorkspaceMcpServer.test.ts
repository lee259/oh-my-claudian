import type { ObsidianWorkspaceAdapter } from '@/core/obsidian/ObsidianWorkspaceAdapter';
import {
  CLAUDE_OBSIDIAN_MCP_SERVER_NAME,
  createClaudeObsidianWorkspaceMcpServer,
} from '@/providers/claude/runtime/ClaudeObsidianWorkspaceMcpServer';

function createAdapter(): jest.Mocked<ObsidianWorkspaceAdapter> {
  return {
    setProperty: jest.fn(),
    move: jest.fn(),
    trash: jest.fn(),
    backlinks: jest.fn(),
  };
}

describe('Claude Obsidian MCP server', () => {
  it('creates an in-process MCP server with the workspace tool', () => {
    const server = createClaudeObsidianWorkspaceMcpServer(createAdapter());

    expect(server.name).toBe(CLAUDE_OBSIDIAN_MCP_SERVER_NAME);
    expect(server.instance).toBeDefined();
  });
});
