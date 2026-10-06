import { OBSIDIAN_WORKSPACE_MCP_SERVER_NAME } from '@/core/obsidian/ObsidianWorkspaceTool';

/** Pi extension that registers Claudian's session-scoped Obsidian MCP endpoint. */
export const PI_OBSIDIAN_MCP_EXTENSION_SOURCE = `export default function claudianObsidianExtension(pi) {
  const endpoint = process.env.CLAUDIAN_OBSIDIAN_TOOL_ENDPOINT;
  const token = process.env.CLAUDIAN_OBSIDIAN_TOOL_TOKEN;
  if (!endpoint || !token) return;

  pi.registerMcpServer('${OBSIDIAN_WORKSPACE_MCP_SERVER_NAME}', {
    url: endpoint,
    headers: { Authorization: 'Bearer ' + token },
    exposure: 'direct',
    description: 'Obsidian vault actions through the currently open vault.',
  });
}
`;
