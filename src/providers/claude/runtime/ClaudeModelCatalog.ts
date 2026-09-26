import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { ProviderModelCatalogRefreshResult } from '../../../core/providers/types';
import { getClaudeProviderSettings, updateClaudeProviderSettings } from '../settings';
import { probeClaudeModels } from './probeClaudeModels';

/** Explicit, cancellable SDK discovery for the Claude settings model list. */
export class ClaudeModelCatalog {
  private controller: AbortController | null = null;
  private flight: Promise<ProviderModelCatalogRefreshResult> | null = null;
  private disposed = false;

  constructor(private readonly host: ProviderHost) {}

  async refresh(): Promise<ProviderModelCatalogRefreshResult> {
    if (this.disposed || !getClaudeProviderSettings(this.host.settings).enabled) {
      return { changed: false };
    }
    if (this.flight) return this.flight;

    const controller = new AbortController();
    this.controller = controller;
    const flight = this.discover(controller).finally(() => {
      if (this.flight === flight) {
        this.flight = null;
        this.controller = null;
      }
    });
    this.flight = flight;
    return flight;
  }

  private async discover(controller: AbortController): Promise<ProviderModelCatalogRefreshResult> {
    const isCurrent = (): boolean => !controller.signal.aborted
      && !this.disposed
      && getClaudeProviderSettings(this.host.settings).enabled;
    try {
      const models = await probeClaudeModels(this.host, controller.signal);
      if (!isCurrent()) return { changed: false };
      await this.host.mutateSettingsConditionally(settings => {
        if (!isCurrent()) return false;
        updateClaudeProviderSettings(settings, { discoveredModels: models });
        return true;
      });
      if (!isCurrent()) return { changed: false };
      this.host.notifyProviderChatOptionsChanged('claude');
      return { changed: true, persistedSettingsChanged: true };
    } catch (error) {
      if (!isCurrent()) return { changed: false };
      return {
        changed: false,
        diagnostics: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async cancel(): Promise<void> {
    this.controller?.abort();
    await this.flight;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.cancel();
  }
}
