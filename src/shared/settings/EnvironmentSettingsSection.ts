import { Setting } from 'obsidian';
import { h } from 'preact';

import { getEnvironmentReviewKeysForScope } from '../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../core/providers/ProviderHost';
import type { EnvironmentScope } from '../../core/types/settings';
import { createPreactRoot, type PreactRoot } from '../ui/PreactRoot';
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
  usePreactEnvironmentField?: boolean;
  usePreactSnippetList?: boolean;
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
    usePreactEnvironmentField = false,
    usePreactSnippetList = false,
  } = options;

  if (heading) {
    new Setting(container).setName(heading).setHeading();
  }

  let contextLimitsContainer: HTMLElement | null = null;
  let environmentRoot: PreactRoot | null = null;

  if (usePreactEnvironmentField) {
    const environmentHost = container.createDiv({ cls: 'claudian-environment-field-host' });
    environmentRoot = createPreactRoot(environmentHost);
    environmentRoot.render(h(EnvironmentVariableSettingsView, {
      scope,
      name,
      description: desc,
      placeholder,
      initialValue: plugin.getEnvironmentVariablesForScope(scope),
      onApply: async (value) => {
        await plugin.applyEnvironmentVariables(scope, value);
        if (contextLimitsContainer) {
          renderCustomContextLimits?.(contextLimitsContainer);
        }
      },
    }));
  } else {
    let envTextarea: HTMLTextAreaElement | null = null;
    const reviewEl = container.createDiv({
      cls: 'claudian-env-review-warning claudian-setting-validation claudian-setting-validation-warning claudian-hidden',
    });

    const updateReviewWarning = () => {
      const reviewKeys = getEnvironmentReviewKeysForScope(envTextarea?.value ?? '', scope);
      if (reviewKeys.length === 0) {
        reviewEl.toggleClass('claudian-hidden', true);
        reviewEl.empty();
        return;
      }

      reviewEl.setText(`Review environment ownership for: ${reviewKeys.join(', ')}`);
      reviewEl.toggleClass('claudian-hidden', false);
    };

    new Setting(container)
      .setName(name)
      .setDesc(desc)
      .addTextArea((text) => {
        text
          .setPlaceholder(placeholder)
          .setValue(plugin.getEnvironmentVariablesForScope(scope));
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
        text.inputEl.addClass('claudian-settings-env-textarea');
        text.inputEl.dataset.envScope = scope;
        text.inputEl.addEventListener('input', () => updateReviewWarning());
        text.inputEl.addEventListener('blur', () => {
          void (async (): Promise<void> => {
            await plugin.applyEnvironmentVariables(scope, text.inputEl.value);
            if (contextLimitsContainer) {
              renderCustomContextLimits?.(contextLimitsContainer);
            }
            updateReviewWarning();
          })();
        });
        envTextarea = text.inputEl;
      });

    updateReviewWarning();
  }

  contextLimitsContainer = container.createDiv({ cls: 'claudian-context-limits-container' });
  renderCustomContextLimits?.(contextLimitsContainer);

  const envSnippetsContainer = container.createDiv({ cls: 'claudian-env-snippets-container' });
  const snippetManager = new EnvSnippetManager(envSnippetsContainer, plugin, scope, () => {
    renderCustomContextLimits?.(contextLimitsContainer);
  }, {
    usePreactView: usePreactSnippetList,
  });

  return {
    destroy() {
      snippetManager.destroy();
      environmentRoot?.unmount();
    },
  };
}
