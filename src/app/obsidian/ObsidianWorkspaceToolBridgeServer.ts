import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import type {
  ObsidianWorkspaceAdapter,
  ObsidianWorkspaceOperation,
} from '../../core/obsidian/ObsidianWorkspaceAdapter';
import {
  executeObsidianWorkspaceTool,
  OBSIDIAN_VAULT_TOOL_NAME,
  OBSIDIAN_WORKSPACE_OPERATIONS,
  OBSIDIAN_WORKSPACE_TOOL_DESCRIPTION,
  OBSIDIAN_WORKSPACE_TOOL_INPUT_SCHEMA,
} from '../../core/obsidian/ObsidianWorkspaceTool';
import type {
  ObsidianWorkspaceToolBridge,
  ObsidianWorkspaceToolBridgeConnection,
} from '../../core/obsidian/ObsidianWorkspaceToolBridge';

const TOOL_PATH = '/mcp';
const OPERATIONS = new Set<ObsidianWorkspaceOperation>(OBSIDIAN_WORKSPACE_OPERATIONS);

type Credential = {
  allowedOperations: ReadonlySet<ObsidianWorkspaceOperation>;
};

/** Bridges provider subprocesses back to the live Obsidian app over loopback HTTP. */
export class ObsidianWorkspaceToolBridgeServer implements ObsidianWorkspaceToolBridge {
  private readonly credentials = new Map<string, Credential>();
  private server: Server | null = null;
  private startPromise: Promise<string> | null = null;
  private disposed = false;

  constructor(private readonly adapter: ObsidianWorkspaceAdapter) {}

  async createConnection(): Promise<ObsidianWorkspaceToolBridgeConnection> {
    if (this.disposed) throw new Error('Obsidian tool bridge has been disposed.');
    const origin = await this.ensureListening();
    const token = randomBytes(32).toString('base64url');
    this.credentials.set(token, { allowedOperations: new Set() });
    return { endpoint: `${origin}${TOOL_PATH}`, token };
  }

  setAllowedOperations(token: string, operations: readonly ObsidianWorkspaceOperation[]): void {
    const credential = this.credentials.get(token);
    if (!credential) return;
    credential.allowedOperations = new Set(operations.filter((operation) => OPERATIONS.has(operation)));
  }

  releaseConnection(token: string): void {
    this.credentials.delete(token);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.credentials.clear();
    await this.startPromise?.catch(() => undefined);
    const server = this.server;
    this.server = null;
    if (!server?.listening) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private ensureListening(): Promise<string> {
    if (this.startPromise) return this.startPromise;
    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.server = server;
    const pending = new Promise<string>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Obsidian tool bridge did not bind to a TCP port.'));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(0, '127.0.0.1');
    });
    this.startPromise = pending;
    pending.catch(() => {
      if (this.server === server) this.server = null;
      if (this.startPromise === pending) this.startPromise = null;
    });
    return pending;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!['POST', 'GET', 'DELETE'].includes(request.method ?? '') || request.url !== TOOL_PATH) {
      writeJson(response, 404, { error: 'Not found.' });
      return;
    }
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      writeJson(response, 403, { error: 'Loopback access is required.' });
      return;
    }
    const token = bearerToken(request.headers.authorization);
    const credential = token ? this.findCredential(token) : null;
    if (!credential) {
      writeJson(response, 401, { error: 'Invalid Obsidian tool bridge credentials.' });
      return;
    }

    const mcp = new McpServer({ name: 'claudian-obsidian', version: '1.0.0' });
    mcp.tool(
      OBSIDIAN_VAULT_TOOL_NAME,
      OBSIDIAN_WORKSPACE_TOOL_DESCRIPTION,
      OBSIDIAN_WORKSPACE_TOOL_INPUT_SCHEMA,
      async (input) => {
        if (!credential.allowedOperations.has(input.operation)) {
          return {
            content: [{ type: 'text' as const, text: 'This Obsidian operation is not allowed for the current provider turn.' }],
            isError: true,
          };
        }
        const result = await executeObsidianWorkspaceTool(this.adapter, input);
        return {
          content: [{ type: 'text' as const, text: result.text }],
          isError: !result.success,
        };
      },
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response);
    } catch (error) {
      if (!response.headersSent) {
        writeJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid MCP request.' });
      }
    } finally {
      await mcp.close().catch(() => undefined);
    }
  }

  private findCredential(candidate: string): Credential | null {
    for (const [token, credential] of this.credentials) {
      const expected = Buffer.from(token);
      const actual = Buffer.from(candidate);
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) return credential;
    }
    return null;
  }
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(header ?? '');
  return match?.[1] ?? null;
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('connection', 'close');
  response.end(JSON.stringify(body));
}
