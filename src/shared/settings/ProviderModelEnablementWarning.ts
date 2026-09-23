import { h } from 'preact';

import type {
  ProviderId,
  ProviderSettingsTabRendererContext,
} from '../../core/providers/types';
import { t } from '../../i18n/i18n';
import { createPreactRoot, type PreactRoot } from '../ui/PreactRoot';
import { ProviderWarningView } from './ProviderWarningView';

export interface ProviderModelEnablementWarning {
  context: ProviderSettingsTabRendererContext;
  destroy(): void;
  refresh(): void;
}

export interface ProviderEnablementWarning {
  destroy(): void;
  hide(): void;
  showFor(durationMs?: number): void;
}

interface StyledProviderWarning {
  destroy(): void;
  setVisible(visible: boolean): void;
}

interface ProviderModelEnablementWarningOptions {
  getHasEnabledModels(): boolean;
  getIsEnabled(): boolean;
  providerId: ProviderId;
  providerName: string;
}

const LAST_PROVIDER_WARNING_DURATION_MS = 10_000;
const warningDestructors = new WeakMap<HTMLElement, () => void>();

/** Unmount provider warning views before their settings host is cleared. */
export function destroyProviderWarnings(container: HTMLElement): void {
  const mounts = Array.from(
    container.querySelectorAll<HTMLElement>('.claudian-provider-warning-mount'),
  );
  if (container.classList.contains('claudian-provider-warning-mount')) mounts.unshift(container);
  mounts.forEach(mount => warningDestructors.get(mount)?.());
}

function renderProviderWarning(
  container: HTMLElement,
  text: string,
  attr?: Record<string, string>,
): StyledProviderWarning {
  const mount = container.createDiv({ cls: 'claudian-provider-warning-mount' });
  const root: PreactRoot = createPreactRoot(mount);
  let visible = false;
  let destroyed = false;

  const render = (): void => {
    if (destroyed) return;
    root.render(h(ProviderWarningView, {
      ariaLive: attr?.['aria-live'] as 'polite' | 'assertive' | undefined,
      message: text,
      role: attr?.role as 'status' | 'alert' | undefined,
      visible,
    }));
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    warningDestructors.delete(mount);
    root.unmount();
    mount.remove();
  };

  warningDestructors.set(mount, destroy);
  render();

  return {
    destroy,
    setVisible(nextVisible) {
      visible = nextVisible;
      render();
    },
  };
}

export function renderLastEnabledProviderWarning(
  container: HTMLElement,
): ProviderEnablementWarning {
  const warning = renderProviderWarning(
    container,
    t('settings.providerEnablement.lastProviderWarning'),
    {
      'aria-live': 'polite',
      role: 'status',
    },
  );
  let hideTimer: number | null = null;
  let destroyed = false;

  const hide = (): void => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
    warning.setVisible(false);
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    hide();
    warning.destroy();
  };

  const showFor = (durationMs = LAST_PROVIDER_WARNING_DURATION_MS): void => {
    if (destroyed) return;
    hide();
    warning.setVisible(true);
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      warning.setVisible(false);
    }, durationMs);
  };

  return { destroy, hide, showFor };
}

export function renderProviderModelEnablementWarning(
  container: HTMLElement,
  context: ProviderSettingsTabRendererContext,
  options: ProviderModelEnablementWarningOptions,
): ProviderModelEnablementWarning {
  const warning = renderProviderWarning(
    container,
    t('settings.providerEnablement.noModelsWarning', {
      provider: options.providerName,
    }),
  );

  const refresh = (): void => {
    const shouldShow = options.getIsEnabled() && !options.getHasEnabledModels();
    warning.setVisible(shouldShow);
  };

  const warningAwareContext: ProviderSettingsTabRendererContext = {
    ...context,
    notifyProviderModelOptionsChanged(providerId) {
      context.notifyProviderModelOptionsChanged(providerId);
      if (providerId === options.providerId) {
        refresh();
      }
    },
  };

  refresh();
  return {
    context: warningAwareContext,
    destroy: () => warning.destroy(),
    refresh,
  };
}
