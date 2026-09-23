import { Setting } from 'obsidian';
import { h } from 'preact';

import { createPreactRoot, type PreactRoot } from '../ui/PreactRoot';
import { HostnameCliPathView } from './HostnameCliPathView';

export interface HostnameCliPathSettingOptions {
  container: HTMLElement;
  description: string;
  disabled?: boolean;
  getValue: () => string;
  name: string;
  onChange: (value: string) => Promise<void> | void;
  placeholder: string;
  validate?: (value: string) => string | null;
}

export interface HostnameCliPathSettingControl {
  dispose: () => void;
  revalidate: () => boolean;
  setDescription: (description: string) => void;
  setDisabled: (disabled: boolean) => void;
  setPlaceholder: (placeholder: string) => void;
  setting: Setting;
  validationEl: HTMLElement;
}

const pathInputDestructors = new WeakMap<HTMLElement, () => void>();

/** Unmount CLI path inputs before their provider settings host is cleared. */
export function destroyHostnameCliPathSettings(container: HTMLElement): void {
  const mounts = Array.from(
    container.querySelectorAll<HTMLElement>('.claudian-cli-path-input-mount'),
  );
  if (container.classList.contains('claudian-cli-path-input-mount')) mounts.unshift(container);
  mounts.forEach(mount => pathInputDestructors.get(mount)?.());
}

export function renderHostnameCliPathSetting(
  options: HostnameCliPathSettingOptions,
): HostnameCliPathSettingControl {
  let currentValue = options.getValue().trim();
  let draftValue = currentValue;
  let disabled = options.disabled ?? false;
  let placeholder = options.placeholder;
  let validationMessage: string | null = null;
  let saveGeneration = 0;
  let disposed = false;

  const setting = new Setting(options.container)
    .setName(options.name)
    .setDesc(options.description);
  const mount = setting.controlEl.createDiv({ cls: 'claudian-cli-path-input-mount' });
  const root: PreactRoot = createPreactRoot(mount);
  const validationEl = options.container.createDiv({
    cls: 'claudian-cli-path-validation claudian-setting-validation claudian-setting-validation-error claudian-hidden',
  });

  const render = (): void => {
    if (disposed) return;
    root.render(h(HostnameCliPathView, {
      disabled,
      name: options.name,
      placeholder,
      validationMessage,
      value: draftValue,
      onInput: (value) => {
        void handleInput(value);
      },
    }));
  };

  const validate = (value: string): boolean => {
    validationMessage = options.validate?.(value) ?? null;
    validationEl.textContent = validationMessage ?? '';
    validationEl.classList.toggle('claudian-hidden', !validationMessage);
    return validationMessage === null;
  };

  const synchronizeValue = (): void => {
    currentValue = options.getValue().trim();
    draftValue = currentValue;
  };

  const handleInput = async (value: string): Promise<void> => {
    if (disposed) return;
    if (disabled) {
      synchronizeValue();
      render();
      return;
    }

    draftValue = value;
    if (!validate(value)) {
      render();
      return;
    }

    const normalizedValue = value.trim();
    if (normalizedValue === currentValue) {
      draftValue = currentValue;
      render();
      return;
    }

    const generation = ++saveGeneration;
    render();
    try {
      await options.onChange(normalizedValue);
      if (generation !== saveGeneration || disposed) return;
      synchronizeValue();
    } catch (error) {
      if (generation === saveGeneration && !disposed) {
        synchronizeValue();
        validate(currentValue);
      }
      throw error;
    } finally {
      if (generation === saveGeneration) render();
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    pathInputDestructors.delete(mount);
    root.unmount();
    mount.remove();
    validationEl.remove();
    setting.settingEl.remove();
  };

  pathInputDestructors.set(mount, dispose);
  validate(currentValue);
  render();

  return {
    dispose,
    revalidate: () => {
      const valid = validate(draftValue);
      render();
      return valid;
    },
    setDescription: (description) => {
      setting.setDesc(description);
    },
    setDisabled: nextDisabled => {
      disabled = nextDisabled;
      render();
    },
    setPlaceholder: nextPlaceholder => {
      placeholder = nextPlaceholder;
      render();
    },
    setting,
    validationEl,
  };
}
