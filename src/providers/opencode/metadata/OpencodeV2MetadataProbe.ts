import { formatReasoningValueLabel } from '@/core/providers/reasoning';
import type { SlashCommand } from '@/core/types';
import { normalizeAcpAvailableCommands } from '@/providers/acp';
import { toAbortError } from '@/utils/abort';

import { OpencodeHttpClient, OpencodeHttpError, type OpencodeHttpEvent } from '../http/OpencodeHttpClient';
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
  subscribe?(onEvent: (event: OpencodeHttpEvent) => void, onError: (error: Error) => void): Promise<void>;
}

/** Reads OpenCode v2 catalogs through its native API without creating a session. */
export class OpencodeV2MetadataProbe implements OpencodeMetadataProbe {
  private models: NativeModel[] | null = null;

  constructor(private readonly client: OpencodeV2MetadataClient) {}

  async loadCatalog(signal?: AbortSignal): Promise<OpencodeMetadataCatalogResult> {
    const ownedSignal = this.client.signal(signal);
    await this.client.waitForActivation(ownedSignal);
    const [models, commands, agents] = await Promise.all([
      this.loadModels(ownedSignal),
      this.readCommands(ownedSignal),
      this.read('agent', ownedSignal),
    ]);
    this.models = models;
    const availableModes = normalizeOpencodeAgentModes(agents);
    return {
      commands,
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
    await this.client.waitForActivation(ownedSignal);
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

  async watchCatalog(onChange: () => Promise<void>, signal: AbortSignal): Promise<void> {
    const ownedSignal = this.client.signal(signal);
    const types = new Set(['model.updated', 'provider.updated', 'command.updated', 'skill.updated']);
    let wake = (): void => {};
    let changed = new Promise<void>(resolve => { wake = resolve; });
    let receivedEvent = false;
    let timer: number | undefined;
    const notify = (): void => wake();
    ownedSignal.addEventListener('abort', notify, { once: true });
    try {
      const deadline = Date.now() + 5_000;
      timer = window.setTimeout(notify, 250);
      void this.client.subscribe?.(event => {
        if (types.has(event.type)) { receivedEvent = true; notify(); }
      }, notify).then(notify, notify);
      for (;;) {
        await changed;
        window.clearTimeout(timer);
        ownedSignal.throwIfAborted();
        changed = new Promise<void>(resolve => { wake = resolve; });
        try { await onChange(); } catch { ownedSignal.throwIfAborted(); }
        const remaining = deadline - Date.now();
        if (!receivedEvent && remaining > 0) timer = window.setTimeout(notify, Math.min(250, remaining));
      }
    } finally {
      window.clearTimeout(timer);
      ownedSignal.removeEventListener('abort', notify);
    }
  }

  private async loadModels(signal: AbortSignal, rawModelId?: string): Promise<NativeModel[]> {
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
      if (!rawModelId || models.some(model => `${model.providerID}/${model.id}` === rawModelId)
        || Date.now() >= deadline) return models;
      await wait(25, signal);
    }
  }

  private async readCommands(signal: AbortSignal): Promise<SlashCommand[]> {
    const [commands, skills] = await Promise.all([
      this.readCommandsWhenReady(signal),
      this.read('skill', signal).catch((error: unknown): unknown[] => {
        if (error instanceof OpencodeHttpError && error.status === 404) return [];
        throw error;
      }),
    ]);
    const commandNames = new Set(commands.map(command => command.name));
    return [
      ...normalizeAcpAvailableCommands(commands.map(command => ({
        name: command.name,
        ...(typeof command.description === 'string' ? { description: command.description } : {}),
      }))).map(command => ({ ...command, kind: 'command' as const })),
      ...skills.filter(isRecord).flatMap((skill): SlashCommand[] => (
        typeof skill.id !== 'string' || commandNames.has(skill.id)
          ? []
          : [{
              id: `opencode-skill:${skill.id}`,
              name: skill.id,
              content: '',
              kind: 'skill',
              source: 'sdk',
              ...(typeof skill.description === 'string' ? { description: skill.description } : {}),
            }]
      )),
    ];
  }

  private async readCommandsWhenReady(signal: AbortSignal): Promise<Array<Record<string, unknown> & { name: string }>> {
    return (await this.read('command', signal)).filter(isNamedRecord);
  }

  private async read(resource: 'model' | 'command' | 'agent' | 'skill', signal: AbortSignal): Promise<unknown[]> {
    const result: unknown = await this.client.request<unknown>(`/api/${resource}`, { signal });
    if (Array.isArray(result)) return result as unknown[];
    if (!isRecord(result) || !Array.isArray(result.data)) throw new Error('Invalid OpenCode catalog response.');
    return result.data as unknown[];
  }
}

export class OpencodeV2MetadataClientProcess extends OpencodeHttpClient {}

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
