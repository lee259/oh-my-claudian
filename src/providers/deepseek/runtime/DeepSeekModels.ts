import type { ProviderHost } from '@/core/providers/ProviderHost';

import { type DeepSeekModel, encodeDeepSeekModelId } from '../models';
import { isRecord } from '../remote/DeepSeekRemoteClient';
import { getDeepSeekProviderSettings, isDeepSeekModelSelectable, updateDeepSeekProviderSettings } from '../settings';

export function assertDeepSeekModelAvailable(settings: Record<string, unknown>, requestedModel: string | undefined): void {
  const model = requestedModel ?? (typeof settings.model === 'string' ? settings.model : '');
  const config = getDeepSeekProviderSettings(settings);
  if (!config.enabled || !isDeepSeekModelSelectable(config, model)) {
    throw new Error('This DeepSeek Harness model is unavailable. Enable an available model in settings before sending.');
  }
}

export class DeepSeekModelCatalog {
  private transition = false;
  private ended = false;
  private running?: Promise<{ changed: boolean; persistedSettingsChanged?: boolean }>;
  private abort?: AbortController;
  constructor(private readonly host: ProviderHost, private readonly discover: (signal: AbortSignal) => Promise<unknown>) {}
  refresh(context?: { signal?: AbortSignal; providerTransitionOwner?: boolean }): Promise<{ changed: boolean; persistedSettingsChanged?: boolean }> {
    if (this.ended || (this.transition && !context?.providerTransitionOwner)) return Promise.resolve({ changed: false });
    if (this.running) return this.running;
    const abort = this.abort = new AbortController();
    const signal = context?.signal ? AbortSignal.any([context.signal, abort.signal]) : abort.signal;
    const task = this.readCatalog(signal);
    this.running = task;
    void task.finally(() => { if (this.running === task) this.running = undefined; }).catch(() => {});
    return task;
  }
  private async readCatalog(signal: AbortSignal): Promise<{ changed: boolean; persistedSettingsChanged?: boolean }> {
    const models = decodeCatalog(await this.discover(signal));
    signal.throwIfAborted();
    let changed = false;
    await this.host.mutateSettings(settings => {
      signal.throwIfAborted();
      const current = getDeepSeekProviderSettings(settings);
      const ids = new Set(models.map(model => model.encodedId));
      const missing = current.discoveredModels.filter(model => current.visibleModels.includes(model.encodedId) && !ids.has(model.encodedId)).map(model => ({ ...model, available: false }));
      const discoveredModels = [...models, ...missing];
      changed = JSON.stringify(current.discoveredModels) !== JSON.stringify(discoveredModels);
      updateDeepSeekProviderSettings(settings, { discoveredModels });
    });
    return { changed, persistedSettingsChanged: changed };
  }
  beginTransition(): void { this.transition = true; this.abort?.abort(); }
  endTransition(): void { this.transition = false; }
  async quiesce(): Promise<void> { await this.running?.catch(() => {}); }
  async dispose(): Promise<void> { this.ended = true; this.beginTransition(); await this.quiesce(); }
}

export function createDeepSeekModels(host: ProviderHost, discover: (signal: AbortSignal) => Promise<unknown>): DeepSeekModelCatalog {
  return new DeepSeekModelCatalog(host, discover);
}

function decodeCatalog(value: unknown): DeepSeekModel[] {
  if (!isRecord(value) || !Array.isArray(value.groups)) throw new Error('Malformed DeepSeek model catalog.');
  const models: DeepSeekModel[] = [];
  for (const group of value.groups) {
    if (!isRecord(group) || typeof group.id !== 'string' || !Array.isArray(group.models)) throw new Error('Malformed DeepSeek model group.');
    for (const native of group.models) {
      if (!isRecord(native) || typeof native.id !== 'string') throw new Error('Malformed DeepSeek model.');
      const reasoning = isRecord(native.reasoning) && Array.isArray(native.reasoning.efforts) ? native.reasoning.efforts : [];
      models.push({ encodedId: encodeDeepSeekModelId(group.id, native.id), provider: group.id, id: native.id,
        label: typeof native.name === 'string' ? native.name : native.id,
        description: typeof native.description === 'string' ? native.description : undefined,
        reasoning: reasoning.filter(isRecord).filter(effort => typeof effort.id === 'string').map(effort => ({ id: effort.id as string, name: typeof effort.name === 'string' ? effort.name : effort.id as string })),
        available: true,
      });
    }
  }
  return models;
}
