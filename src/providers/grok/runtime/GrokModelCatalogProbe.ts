import { AcpJsonRpcTransport, AcpSubprocess } from '../../acp';
import {
  type NormalizedGrokSessionModels,
  normalizeGrokSessionModelMetadata,
  parseGrokModelUpdateState,
} from '../execution/GrokSessionModelMetadata';

export interface GrokModelCatalogProbeRequest {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
  version: string;
}

export interface GrokModelCatalogProbeLike {
  discover(request: GrokModelCatalogProbeRequest): Promise<NormalizedGrokSessionModels>;
}

/** Owns a short-lived ACP process; model discovery never creates a chat session. */
export class GrokModelCatalogProbe implements GrokModelCatalogProbeLike {
  async discover(request: GrokModelCatalogProbeRequest): Promise<NormalizedGrokSessionModels> {
    request.signal?.throwIfAborted();
    const subprocess = new AcpSubprocess({
      args: ['agent', '--no-leader', 'stdio'],
      command: request.command,
      cwd: request.cwd,
      env: request.env,
    });
    let transport: AcpJsonRpcTransport | undefined;

    try {
      subprocess.start();
      transport = new AcpJsonRpcTransport({
        input: subprocess.stdout,
        onClose: listener => subprocess.onClose(listener),
        output: subprocess.stdin,
      });
      const options = { signal: request.signal, timeoutMs: request.timeoutMs };
      await transport.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: 'claudian', version: request.version },
      }, options);

      const response = await transport.request<unknown>(
        '_x.ai/models/list',
        {},
        options,
      );
      const models = parseGrokModelUpdateState(response);
      if (!models) throw new Error('Grok returned malformed model metadata.');

      return normalizeGrokSessionModelMetadata({ models });
    } finally {
      transport?.dispose();
      await subprocess.shutdown();
    }
  }
}
