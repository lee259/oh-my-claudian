import type { App } from 'obsidian';
import { Notice } from 'obsidian';
import { h } from 'preact';

import type { CliProviderMetadata, CliVersionInfo } from '@/core/providers/cli/CliProviderMetadata';
import { isUpdateAvailable, resolveCliVersionInfo } from '@/core/providers/cli/CliVersionUtils';
import type { ProviderCliAction, ProviderCliLifecyclePort, ProviderCliSnapshot } from '@/core/providers/cli/ProviderCliLifecycle';
import type { ProviderId } from '@/core/providers/types';
import { t } from '@/i18n/i18n';
import { parseEnvironmentVariables } from '@/utils/env';

import { createPreactRoot } from '../ui/PreactRoot';
import { type CliLifecycleAction, CliLifecycleView } from './CliLifecycleView';

export interface CliLifecycleSectionOptions {
  container: HTMLElement;
  metadata: CliProviderMetadata;
  providerId: ProviderId;
  lifecycle?: ProviderCliLifecyclePort;
  resolveCliPath: () => Promise<string | null>;
  getRuntimeEnvText: () => string;
  app: App;
  onCliChanged?: () => Promise<void>;
  onCheckAgain?: () => Promise<void>;
  onProbe?: (info: CliVersionInfo, cliPath: string | null) => void;
}

export interface CliLifecycleSectionController {
  refresh: () => Promise<void>;
}

const lifecycleDestructors = new WeakMap<HTMLElement, () => void>();

export function destroyCliLifecycleSections(container: HTMLElement): void {
  const mounts = Array.from(container.querySelectorAll<HTMLElement>('.claudian-cli-lifecycle-mount'));
  if (container.classList.contains('claudian-cli-lifecycle-mount')) mounts.unshift(container);
  mounts.forEach(mount => lifecycleDestructors.get(mount)?.());
}

/** A presentation of application-owned state; unmounting never cancels its accepted operation. */
export function renderCliLifecycleSection(options: CliLifecycleSectionOptions): CliLifecycleSectionController {
  const mount = options.container.createDiv({ cls: 'claudian-cli-lifecycle-mount' });
  const root = createPreactRoot(mount);
  const lifecycle = options.lifecycle;
  let destroyed = false;
  let snapshot: ProviderCliSnapshot | null = lifecycle?.getSnapshot(options.providerId) ?? null;
  let info: CliVersionInfo | null = null;
  let pendingAction: CliLifecycleAction = null;
  let statusText = t('settings.cliLifecycle.checking');

  const render = (): void => {
    if (destroyed) return;
    root.render(h(CliLifecycleView, {
      statusText, info,
      updateHint: snapshot?.updateHint,
      canInstall: Boolean(lifecycle && snapshot?.canInstall),
      canUpdate: Boolean(lifecycle && snapshot?.canUpdate),
      isUpdateAvailable: isUpdateAvailable(info?.version, info?.latestVersion),
      pendingAction: snapshot?.operation?.status === 'running' ? snapshot.operation.action : pendingAction,
      operation: snapshot?.operation,
      onInstall: () => { void runAction('install'); },
      onUpdate: () => { void runAction('update'); },
      onCheckAgain: () => { void checkAgain(); },
    }));
  };
  const adopt = (next: ProviderCliSnapshot): void => {
    if (destroyed || next.providerId !== options.providerId) return;
    snapshot = next;
    info = {
      version: next.version, latestVersion: next.latestVersion,
      error: next.error, installedButBroken: next.status === 'broken',
    };
    statusText = next.status === 'checking' ? t('settings.cliLifecycle.checking') : '';
    options.onProbe?.(info, next.path);
    render();
  };
  const refresh = async (force = false): Promise<void> => {
    if (destroyed) return;
    try {
      if (lifecycle) {
        adopt(await lifecycle.check(options.providerId, { force }));
      } else {
        // Hosts without the application port may inspect, but cannot execute lifecycle changes.
        const cliPath = await options.resolveCliPath();
        info = await resolveCliVersionInfo(cliPath, options.metadata, undefined, {
          ...process.env, ...parseEnvironmentVariables(options.getRuntimeEnvText()),
        } as Record<string, string>);
        if (destroyed) return;
        statusText = '';
        options.onProbe?.(info, cliPath);
        render();
      }
    } catch (error) {
      statusText = error instanceof Error ? error.message : t('common.error');
      render();
    }
  };
  const runAction = async (action: ProviderCliAction): Promise<void> => {
    if (!lifecycle || pendingAction || snapshot?.operation?.status === 'running') return;
    pendingAction = action;
    render();
    try {
      const plan = await lifecycle.prepareAction(options.providerId, action);
      if (destroyed) return;
      const actionLabel = t(action === 'install' ? 'settings.cliLifecycle.install' : 'settings.cliLifecycle.update');
      const { confirm } = await import('../modals/ConfirmModal');
      if (destroyed) return;
      const accepted = await confirm(options.app, t(
        action === 'install' ? 'settings.cliLifecycle.installConfirm' : 'settings.cliLifecycle.updateConfirm',
        { cli: options.metadata.displayName, command: [plan.command.command, ...plan.command.args].join(' ') },
      ), actionLabel);
      if (!accepted || destroyed) return;
      const result = await lifecycle.executeAction(plan);
      if (!destroyed) {
        adopt(result);
        await options.onCliChanged?.();
      }
    } catch (error) {
      if (!destroyed) new Notice(error instanceof Error ? error.message : t('common.error'));
    } finally {
      pendingAction = null;
      render();
    }
  };
  const checkAgain = async (): Promise<void> => {
    if (pendingAction || snapshot?.operation?.status === 'running') return;
    pendingAction = 'check';
    render();
    try {
      if (lifecycle) adopt(await lifecycle.check(options.providerId, { force: true }));
      await options.onCheckAgain?.();
      await refresh();
    } catch (error) {
      if (!destroyed) new Notice(error instanceof Error ? error.message : t('common.error'));
    } finally {
      pendingAction = null;
      render();
    }
  };
  const unsubscribe = lifecycle?.subscribe(adopt);
  lifecycleDestructors.set(mount, () => {
    destroyed = true;
    unsubscribe?.();
    lifecycleDestructors.delete(mount);
    root.unmount();
    mount.remove();
  });
  if (snapshot) adopt(snapshot);
  render();
  void refresh();
  return { refresh: () => refresh(true) };
}
