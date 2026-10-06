import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { ObsidianWorkspaceToolBridgeServer } from '@/app/obsidian/ObsidianWorkspaceToolBridgeServer';
import type { ObsidianWorkspaceAdapter } from '@/core/obsidian/ObsidianWorkspaceAdapter';

function createAdapter(): ObsidianWorkspaceAdapter & { moved: unknown[][]; trashed: string[] } {
  const adapter: ObsidianWorkspaceAdapter & { moved: unknown[][]; trashed: string[] } = {
    backlinks: async () => ['Notes/source.md'],
    move: async (...args) => { adapter.moved.push(args); },
    setProperty: async () => undefined,
    trash: async (path) => { adapter.trashed.push(path); },
    moved: [],
    trashed: [],
  };
  return adapter;
}

async function connectClient(endpoint: string, token: string): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }));
  return client;
}

describe('ObsidianWorkspaceToolBridgeServer', () => {
  it('routes an authenticated operation through the live Obsidian adapter', async () => {
    const adapter = createAdapter();
    const bridge = new ObsidianWorkspaceToolBridgeServer(adapter);
    const connection = await bridge.createConnection();
    let client: Client | null = null;
    try {
      client = await connectClient(connection.endpoint, connection.token);
      const result = await client.callTool({
        name: 'vault',
        arguments: { operation: 'move', path: 'Notes/old.md', destination: 'Archive/old.md' },
      });

      expect(result.isError).toBe(true);
      bridge.setAllowedOperations(connection.token, ['move']);
      const allowed = await client.callTool({
        name: 'vault',
        arguments: { operation: 'move', path: 'Notes/old.md', destination: 'Archive/old.md' },
      });
      expect(allowed.isError).not.toBe(true);
      expect(adapter.moved).toEqual([['Notes/old.md', 'Archive/old.md']]);
    } finally {
      await client?.close();
      await bridge.dispose();
    }
  });

  it('rejects credentials after their operations have been disabled', async () => {
    const adapter = createAdapter();
    const bridge = new ObsidianWorkspaceToolBridgeServer(adapter);
    const connection = await bridge.createConnection();
    bridge.setAllowedOperations(connection.token, ['backlinks']);
    let client: Client | null = null;
    try {
      client = await connectClient(connection.endpoint, connection.token);
      const result = await client.callTool({
        name: 'vault',
        arguments: { operation: 'trash', path: 'Notes/old.md' },
      });

      expect(result.isError).toBe(true);
      expect(adapter.trashed).toEqual([]);
    } finally {
      await client?.close();
      bridge.releaseConnection(connection.token);
      await bridge.dispose();
    }
  });

  it('does not accept requests without a valid bearer token', async () => {
    const bridge = new ObsidianWorkspaceToolBridgeServer(createAdapter());
    const connection = await bridge.createConnection();
    try {
      const response = await fetch(connection.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } }),
      });

      expect(response.status).toBe(401);
    } finally {
      await bridge.dispose();
    }
  });
});
