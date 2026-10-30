import { Notice, Setting } from 'obsidian';
import { h } from 'preact';

import type { ProviderHost } from '../../core/providers/ProviderHost';
import type { EnvironmentScope } from '../../core/types/settings';
import { t } from '../../i18n/i18n';
import { createPreactRoot } from '../ui/PreactRoot';
import { EnvironmentVariableSettingsView } from './EnvironmentVariableSettingsView';
import { EnvSnippetManager } from './EnvSnippetManager';

interface EnvironmentSettingsSectionOptions {
  container: HTMLElement;
  plugin: ProviderHost;
  scope: EnvironmentScope;
  heading?: string;
  name: string;
  desc: string;
  placeholder: string;
  renderCustomContextLimits?: (container: HTMLElement) => void;
}

const environmentSectionDestructors = new WeakMap<HTMLElement, () => void>();

/** Unmount provider environment views before their settings host is cleared. */
export function destroyEnvironmentSettingsSections(container: HTMLElement): void {
  const mounts = Array.from(
    container.querySelectorAll<HTMLElement>('.claudian-environment-field-host'),
  );
  if (container.classList.contains('claudian-environment-field-host')) mounts.unshift(container);
  mounts.forEach(mount => environmentSectionDestructors.get(mount)?.());
}

export interface EnvironmentSettingsSectionHandle {
  destroy(): void;
}

export function renderEnvironmentSettingsSection(
  options: EnvironmentSettingsSectionOptions,
): EnvironmentSettingsSectionHandle {
  const {
    container,
    plugin,
    scope,
    heading,
    name,
    desc,
    placeholder,
    renderCustomContextLimits,
  } = options;

  if (heading) {
    new Setting(container).setName(heading).setHeading();
  }

  let contextLimitsContainer: HTMLElement | null = null;
  let destroyed = false;

  const applyEnvironment = async (value: string): Promise<boolean> => {
    try {
      await plugin.applyEnvironmentVariables(scope, value);
      if (!destroyed && contextLimitsContainer) {
        renderCustomContextLimits?.(contextLimitsContainer);
      }
      return true;
    } catch {
      new Notice(t('settings.environmentUpdateFailed'));
      return false;
    }
  };

  const environmentHost = container.createDiv({ cls: 'claudian-environment-field-host' });
  const environmentRoot = createPreactRoot(environmentHost);
  environmentRoot.render(h(EnvironmentVariableSettingsView, {
    scope,
    name,
    description: desc,
    placeholder,
    initialValue: plugin.getEnvironmentVariablesForScope(scope),
    onApply: async (value) => {
      await applyEnvironment(value);
    },
  }));

  contextLimitsContainer = container.createDiv({ cls: 'claudian-context-limits-container' });
  renderCustomContextLimits?.(contextLimitsContainer);

  const envSnippetsContainer = container.createDiv({ cls: 'claudian-env-snippets-container' });
  const snippetManager = new EnvSnippetManager(envSnippetsContainer, plugin, scope, () => {
    renderCustomContextLimits?.(contextLimitsContainer);
  });

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    environmentSectionDestructors.delete(environmentHost);
    snippetManager.destroy();
    environmentRoot.unmount();
  };
  environmentSectionDestructors.set(environmentHost, destroy);

  return {
    destroy,
  };
}
