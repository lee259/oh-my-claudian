import {
  AcpClientConnection,
  AcpJsonRpcTransport,
  AcpSubprocess,
} from '@/providers/acp';

import { OpencodeHttpClient } from '../http/OpencodeHttpClient';
import { assertOpencodeSessionCompatibility, detectOpencodeNativeVersion, parseOpencodeNativeVersion } from '../runtime/OpencodeVersion';

export interface OpencodeSessionForkOptions {
  cliPath: string;
  cwd: string;
  environment: NodeJS.ProcessEnv;
  nativeVersion?: 1 | 2;
  onNativeVersion?: (version: 1 | 2 | undefined) => void;
  sourceSessionId: string;
}

/** Creates the native child before the source can accept another turn. */
export async function forkOpencodeSession(options: OpencodeSessionForkOptions): Promise<string> {
  const detectedVersion = await detectOpencodeNativeVersion(options.cliPath, options.environment);
  assertOpencodeSessionCompatibility(options.nativeVersion, detectedVersion);
  const version = detectedVersion ?? options.nativeVersion ?? 1;

  if (version === 2) {
    const client = new OpencodeHttpClient(options.cliPath, options.cwd, options.environment);
    try {
      await client.waitForActivation();
      const response = await client.request<{ data?: { id?: unknown } }>(
        `/api/session/${encodeURIComponent(options.sourceSessionId)}/fork`,
        { method: 'POST', body: {} },
      );
      const sessionId = response.data?.id;
      if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId === options.sourceSessionId) {
        throw new Error('OpenCode fork returned an invalid child session.');
      }
      options.onNativeVersion?.(2);
      return sessionId;
    } finally {
      await client.dispose();
    }
  }

  const subprocess = new AcpSubprocess({
    command: options.cliPath,
    args: ['acp'],
    cwd: options.cwd,
    env: options.environment,
  });
  let transport: AcpJsonRpcTransport | undefined;
  let connection: AcpClientConnection | undefined;
  try {
    subprocess.start();
    transport = new AcpJsonRpcTransport({
      input: subprocess.stdout,
      output: subprocess.stdin,
      onClose: listener => subprocess.onClose(listener),
    });
    connection = new AcpClientConnection({ transport });
    transport.start();
    const initialized = await connection.initialize();
    const runtimeVersion = parseOpencodeNativeVersion(initialized.agentInfo?.version);
    assertOpencodeSessionCompatibility(options.nativeVersion, runtimeVersion);
    options.onNativeVersion?.(runtimeVersion);
    if (!initialized.agentCapabilities?.sessionCapabilities?.fork) {
      throw new Error('This OpenCode version does not support ACP session forking. Update OpenCode to fork conversations.');
    }
    const response = await connection.forkSession({
      cwd: options.cwd,
      mcpServers: [],
      sessionId: options.sourceSessionId,
    });
    if (!response.sessionId.trim() || response.sessionId === options.sourceSessionId) {
      throw new Error('OpenCode fork returned an invalid child session.');
    }
    return response.sessionId;
  } finally {
    connection?.dispose();
    transport?.dispose();
    await subprocess.shutdown();
  }
}
