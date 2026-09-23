import { Setting } from 'obsidian';
import { h } from 'preact';

import { createPreactRoot, type PreactRoot } from '../ui/PreactRoot';
import { ProviderModelPickerView } from './ProviderModelPickerView';

const VISIBLE_MODELS_DESCRIPTION = 'Choose which models are available in the chat selector. Drag to reorder them; the provider uses the first currently usable model as its default. Select at least one model to use this provider.';
const pickerDestructors = new WeakMap<HTMLElement, () => void>();

/** Unmount Provider Model Picker roots before their settings tab is cleared. */
export function destroyProviderModelPickers(container: HTMLElement): void {
  const mounts = Array.from(container.querySelectorAll<HTMLElement>('.claudian-provider-model-picker-mount'));
  if (container.classList.contains('claudian-provider-model-picker-mount')) mounts.unshift(container);
  mounts.forEach(mount => pickerDestructors.get(mount)?.());
}

export function reorderProviderModelIds(
  selectedIds: readonly string[],
  modelId: string,
  targetIndex: number,
): string[] {
  const currentIndex = selectedIds.indexOf(modelId);
  if (currentIndex < 0) return [...selectedIds];
  const next = [...selectedIds];
  next.splice(currentIndex, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, modelId);
  return next;
}

export interface ProviderModelPickerModel {
  aliasPlaceholder?: string;
  catalogBadge?: string;
  description?: string;
  id: string;
  isAvailable?: boolean;
  name: string;
  providerKey?: string;
  providerLabel?: string;
  unavailableMessage?: string;
  unavailableTitle?: string;
}

export interface ProviderModelPickerState {
  aliases: Record<string, string>;
  catalogRefreshedAt?: number;
  catalogStatus?: 'empty' | 'ready' | 'stale' | 'failed';
  defaultModelId?: string | null;
  discoveredCount: number;
  models: ProviderModelPickerModel[];
  selectionMode?: 'all' | 'explicit';
  selectedIds: string[];
}

export interface ProviderModelPickerController {
  refresh(): void;
  dispose(): void;
}

export interface ProviderModelPickerOptions {
  checkCatalogFreshnessWhenCached?: boolean;
  container: HTMLElement;
  emptyCatalogText: string;
  failedCatalogText: string;
  getState(): ProviderModelPickerState;
  initiallyOpen?: boolean;
  loadCatalog(force: boolean): Promise<'empty' | 'failed' | 'loaded'>;
  loadCatalogOnRender?: boolean;
  loadingCatalogText: string;
  modifier: string;
  onAliasesChange(aliases: Record<string, string>): Promise<void>;
  onModelSelected?(model: ProviderModelPickerModel): Promise<void>;
  onSelectedIdsChange(selectedIds: string[]): Promise<void>;
  providerName: string;
  searchPlaceholder?: string;
}

export function renderProviderModelPicker(
  options: ProviderModelPickerOptions,
): ProviderModelPickerController {
  const visibleModelsSetting = new Setting(options.container)
    .setName('Visible models')
    .setDesc(VISIBLE_MODELS_DESCRIPTION);
  visibleModelsSetting.settingEl.addClass('claudian-provider-model-picker-setting');

  const mount = options.container.createDiv({ cls: 'claudian-provider-model-picker-mount' });
  const root: PreactRoot = createPreactRoot(mount);
  let loadingCatalog = false;
  let catalogLoadFailed = false;
  let disposed = false;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    pickerDestructors.delete(mount);
    root.unmount();
    mount.remove();
  };
  pickerDestructors.set(mount, dispose);

  const render = (): void => {
    if (disposed) return;
    root.render(h(ProviderModelPickerView, {
      options,
      state: options.getState(),
      loadingCatalog,
      catalogLoadFailed,
      onLoadCatalog: (force: boolean) => { void loadCatalog(force); },
      onAliasesChange: async (aliases: Record<string, string>) => {
        await options.onAliasesChange(aliases);
        render();
      },
      onSelectedIdsChange: async (selectedIds: string[]) => {
        await options.onSelectedIdsChange(selectedIds);
        render();
      },
    }));
  };

  const loadCatalog = async (force: boolean): Promise<void> => {
    if (
      disposed
      || loadingCatalog
      || (
        !force
        && !options.checkCatalogFreshnessWhenCached
        && options.getState().discoveredCount > 0
      )
    ) {
      return;
    }

    loadingCatalog = true;
    catalogLoadFailed = false;
    render();
    try {
      catalogLoadFailed = await options.loadCatalog(force) === 'failed';
    } catch {
      catalogLoadFailed = true;
    } finally {
      loadingCatalog = false;
      render();
    }
  };

  render();
  if (options.loadCatalogOnRender) void loadCatalog(false);
  return {
    refresh: render,
    dispose,
  };
}
