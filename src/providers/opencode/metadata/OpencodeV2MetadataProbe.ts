import { randomBytes } from 'node:crypto';
import { type IncomingMessage, request } from 'node:http';

import { ManagedStdioProcess } from '@/core/process/ManagedStdioProcess';
import { formatReasoningValueLabel } from '@/core/providers/reasoning';
import { normalizeAcpAvailableCommands } from '@/providers/acp';
import { toAbortError } from '@/utils/abort';

import { normalizeOpencodeAgentModes } from '../modes';
import type {
  OpencodeMetadataCatalogResult,
  OpencodeMetadataProbe,
  OpencodeMetadataWarmResult,
} from './OpencodeMetadataService';

interface NativeModel {
  id: string;
  providerID: string;
  name: string;
  variants: string[];
}

export interface OpencodeV2MetadataClient {
  dispose(): Promise<void>;
  request<T = unknown>(route: string, options?: { signal?: AbortSignal }): Promise<T>;
  signal(signal?: AbortSignal): AbortSignal;
  waitForActivation(signal?: AbortSignal): Promise<void>;
}

/** Reads OpenCode v2 catalogs through its native API without creating a session. */
export class OpencodeV2MetadataProbe implements OpencodeMetadataProbe {
  private models: NativeModel[] | null = null;

  constructor(private readonly client: OpencodeV2MetadataClient) {}

  async loadCatalog(signal?: AbortSignal): Promise<OpencodeMetadataCatalogResult> {
    const ownedSignal = this.client.signal(signal);
    const models = this.models = await this.loadModels(ownedSignal);
    const commands = await this.read('command', ownedSignal);
    const agents = await this.read('agent', ownedSignal);
    const availableModes = normalizeOpencodeAgentModes(agents);
    return {
      commands: normalizeAcpAvailableCommands(commands.filter(isNamedRecord).map(command => ({
        name: command.name,
        ...(typeof command.description === 'string' ? { description: command.description } : {}),
      }))),
      models: modelState(models),
      modes: {
        availableModes,
        currentModeId: availableModes[0]?.id ?? '',
      },
    };
  }

  async warmModel(rawModelId: string, signal?: AbortSignal): Promise<OpencodeMetadataWarmResult> {
    const ownedSignal = this.client.signal(signal);
    ownedSignal.throwIfAborted();
    const models = this.models?.some(model => `${model.providerID}/${model.id}` === rawModelId)
      ? this.models
      : this.models = await this.loadModels(ownedSignal, rawModelId);
    const model = models.find(item => `${item.providerID}/${item.id}` === rawModelId);
    if (!model) throw new Error('OpenCode model is no longer available. Refresh the model catalog.');
    const variants = model.variants.length > 0 ? [...new Set([...model.variants, 'default'])] : [];
    return {
      rawModelId,
      models: modelState(models),
      configOptions: [{
        id: 'effort',
        name: 'Effort',
        category: 'thought_level',
        type: 'select',
        currentValue: 'default',
        options: variants.map(value => ({ value, name: formatReasoningValueLabel(value) })),
      }],
    };
  }

  async dispose(): Promise<void> {
    await this.client.dispose();
  }

  private async loadModels(signal: AbortSignal, rawModelId?: string): Promise<NativeModel[]> {
    await this.client.waitForActivation(signal);
    const deadline = Date.now() + 5_000;
    for (;;) {
      signal.throwIfAborted();
      const models = (await this.read('model', signal)).filter(isNamedRecord).flatMap(model => {
        if (model.enabled !== true || typeof model.id !== 'string' || typeof model.providerID !== 'string') return [];
        return [{
          id: model.id,
          providerID: model.providerID,
          name: model.name,
          variants: Array.isArray(model.variants)
            ? model.variants.filter(isRecord).flatMap(variant => typeof variant.id === 'string' ? [variant.id] : [])
            : [],
        }];
      });
      if ((rawModelId && models.some(model => `${model.providerID}/${model.id}` === rawModelId))
        || (!rawModelId && models.length > 0)
        || Date.now() >= deadline) return models;
      await wait(25, signal);
    }
  }

  private async read(resource: 'model' | 'command' | 'agent', signal: AbortSignal): Promise<unknown[]> {
    const result: unknown = await this.client.request<unknown>(`/api/${resource}`, { signal });
    if (Array.isArray(result)) return result as unknown[];
    if (!isRecord(result) || !Array.isArray(result.data)) throw new Error('Invalid OpenCode catalog response.');
    return result.data as unknown[];
  }
}

export class OpencodeV2MetadataClientProcess implements OpencodeV2MetadataClient {
  private readonly controller = new AbortController();
  private readonly password = randomBytes(32).toString('base64url');
  private readonly process: ManagedStdioProcess;
  private endpoint: Promise<string> | null = null;

  constructor(command: string, private readonly cwd: string, environment: NodeJS.ProcessEnv) {
    this.process = new ManagedStdioProcess({
      command,
      args: ['serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0'],
      cwd,
      env: { ...environment, OPENCODE_PASSWORD: this.password },
    });
  }

  signal(signal?: AbortSignal): AbortSignal {
    return signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
  }

  async waitForActivation(signal?: AbortSignal): Promise<void> {
    const ownedSignal = this.signal(signal);
    try {
      await this.request('/api/integration', { signal: ownedSignal });
    } catch {
      ownedSignal.throwIfAborted();
    }
  }

  async request<T = unknown>(route: string, options: { signal?: AbortSignal } = {}): Promise<T> {
    const signal = this.signal(options.signal);
    signal.throwIfAborted();
    const endpoint = await this.getEndpoint(signal);
    const url = new URL(route, endpoint);
    if (url.origin !== endpoint) throw new Error('Invalid OpenCode API route.');
    url.searchParams.set('location[directory]', this.cwd);
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = request(url, {
        method: 'GET',
        signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`,
        },
      }, resolve);
      req.on('error', reject);
      const timer = window.setTimeout(() => req.destroy(new Error('OpenCode HTTP request timed out.')), 30_000);
      req.on('close', () => window.clearTimeout(timer));
      req.end();
    });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const value of response) {
      const chunk = value as Buffer;
      size += chunk.length;
      if (size > 32 * 1024 * 1024) {
        response.destroy();
        throw new Error('OpenCode HTTP response exceeded the size limit.');
      }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    if (response.statusCode! < 200 || response.statusCode! >= 300) {
      throw new Error(`OpenCode HTTP request failed (${response.statusCode}): ${body.slice(0, 1000)}`);
    }
    return (body ? JSON.parse(body) : undefined) as T;
  }

  async dispose(): Promise<void> {
    this.controller.abort();
    await this.process.shutdown();
  }

  private getEndpoint(signal: AbortSignal): Promise<string> {
    this.endpoint ??= new Promise<string>((resolve, reject) => {
      let output = '';
      let settled = false;
      const finish = (error?: Error, endpoint?: string): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(endpoint!);
      };
      const abort = (): void => finish(toAbortError(signal, 'OpenCode server startup aborted.'));
      const timer = window.setTimeout(() => finish(new Error('OpenCode server startup timed out.')), 10_000);
      signal.addEventListener('abort', abort, { once: true });
      this.process.onError(() => finish(new Error('Could not start the OpenCode server.')));
      this.process.onClose(() => finish(new Error('OpenCode server closed before readiness.')));
      try {
        signal.throwIfAborted();
        this.process.start();
        this.process.stdout.on('data', (chunk: Buffer) => {
          if (settled) return;
          output += chunk.toString('utf8');
          if (output.length > 16_384) return finish(new Error('Invalid OpenCode catalog server readiness response.'));
          const end = output.indexOf('\n');
          if (end < 0) return;
          try {
            const ready: unknown = JSON.parse(output.slice(0, end));
            if (!isRecord(ready) || typeof ready.url !== 'string') throw new Error();
            const url = new URL(ready.url);
            if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error();
            finish(undefined, url.origin);
          } catch {
            finish(new Error('Invalid OpenCode catalog server readiness response.'));
          }
        });
      } catch {
        finish(new Error('Could not start the OpenCode server.'));
      }
    });
    return this.endpoint;
  }
}

function modelState(models: NativeModel[]): NonNullable<OpencodeMetadataCatalogResult['models']> {
  return {
    currentModelId: '',
    availableModels: models.map(model => ({
      modelId: `${model.providerID}/${model.id}`,
      name: `${model.providerID}/${model.name}`,
    })),
  };
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = (): void => {
      window.clearTimeout(timer);
      reject(toAbortError(signal, 'OpenCode request aborted.'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNamedRecord(value: unknown): value is Record<string, unknown> & { name: string } {
  return isRecord(value) && typeof value.name === 'string';
}
