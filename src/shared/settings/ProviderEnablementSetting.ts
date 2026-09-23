import { Setting } from 'obsidian';
import { h } from 'preact';

import { createPreactRoot, type PreactRoot } from '../ui/PreactRoot';
import { ProviderEnablementView } from './ProviderEnablementView';

export interface ProviderEnablementSettingOptions {
  container: HTMLElement;
  description: string;
  disabled?: boolean;
  getValue: () => boolean;
  name: string;
  onChange: (enabled: boolean) => Promise<void> | void;
}

export interface ProviderEnablementSettingControl {
  dispose: () => void;
  setDisabled: (disabled: boolean) => void;
}

const enablementDestructors = new WeakMap<HTMLElement, () => void>();

/** Unmount provider enablement views before their settings host is cleared. */
export function destroyProviderEnablementSettings(container: HTMLElement): void {
  const mounts = Array.from(
    container.querySelectorAll<HTMLElement>('.claudian-provider-enablement-mount'),
  );
  if (container.classList.contains('claudian-provider-enablement-mount')) mounts.unshift(container);
  mounts.forEach(mount => enablementDestructors.get(mount)?.());
}

export function renderProviderEnablementSetting(
  options: ProviderEnablementSettingOptions,
): ProviderEnablementSettingControl {
  const setting = new Setting(options.container)
    .setName(options.name)
    .setDesc(options.description);
  const mount = setting.controlEl.createDiv({ cls: 'claudian-provider-enablement-mount' });
  const root: PreactRoot = createPreactRoot(mount);
  let disabled = options.disabled ?? false;
  let disposed = false;

  const render = (): void => {
    if (disposed) return;
    root.render(h(ProviderEnablementView, {
      disabled,
      name: options.name,
      value: options.getValue(),
      onChange: (enabled) => {
        void handleChange(enabled);
      },
    }));
  };

  const handleChange = async (enabled: boolean): Promise<void> => {
    if (disposed) return;
    if (disabled) {
      render();
      return;
    }

    try {
      await options.onChange(enabled);
    } finally {
      render();
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    enablementDestructors.delete(mount);
    root.unmount();
    setting.settingEl.remove();
  };

  enablementDestructors.set(mount, dispose);
  render();

  return {
    dispose,
    setDisabled: (nextDisabled) => {
      disabled = nextDisabled;
      render();
    },
  };
}
