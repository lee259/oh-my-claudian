import type { App, Modal } from 'obsidian';
import { Notice } from 'obsidian';
import { h } from 'preact';

import type { ProviderCliLifecyclePort, ProviderCliSnapshot } from '@/core/providers/cli/ProviderCliLifecycle';
import { t } from '@/i18n/i18n';
import { createPreactRoot } from '@/shared/ui/PreactRoot';

import { ProviderCliUpdateNoticeView } from './ProviderCliUpdateNoticeView';
import { ProviderCliUpdatesView } from './ProviderCliUpdatesView';

/** General settings provides an entry point; detailed state belongs in the modal. */
export function mountProviderCliUpdateCheck(
  container: HTMLElement, app: App, lifecycle: ProviderCliLifecyclePort,
): () => void {
  const mount = container.createDiv({ cls: 'claudian-cli-update-check-mount' });
  const root = createPreactRoot(mount);
  let destroyed = false;
  let checking = false;
  let modal: Modal | null = null;
  const render = (): void => {
    if (destroyed) return;
    root.render(h('div', { className: 'setting-item claudian-cli-update-check' },
      h('div', { className: 'setting-item-info' },
        h('div', { className: 'setting-item-name' }, t('settings.cliUpdates.title')),
        h('div', { className: 'setting-item-description' }, t('settings.cliUpdates.summary'))),
      h('div', { className: 'setting-item-control' },
        h('button', {
          type: 'button', className: 'claudian-cli-update-check-button', disabled: checking,
          onClick: () => { void check(); },
        }, t(checking ? 'settings.cliUpdates.checking' : 'settings.cliUpdates.checkUpdates')))));
  };
  const check = async (): Promise<void> => {
    if (checking || destroyed) return;
    checking = true;
    render();
    try {
      const snapshots = await lifecycle.checkEnabled({ force: true });
      if (destroyed) return;
      if (!snapshots.some(snapshot => snapshot.enabled && snapshot.canUpdate)) {
        new Notice(t('settings.cliUpdates.noUpdates'));
        return;
      }
      const { ProviderCliUpdatesModal } = await import('./ProviderCliUpdatesModal');
      if (destroyed) return;
      modal?.close();
      modal = new ProviderCliUpdatesModal(app, lifecycle);
      modal.open();
    } catch (cause) {
      if (!destroyed) new Notice(cause instanceof Error ? cause.message : t('common.error'));
    } finally {
      checking = false;
      render();
    }
  };
  render();
  return () => {
    destroyed = true;
    modal?.close();
    root.unmount();
    mount.remove();
  };
}

export function mountProviderCliUpdates(
  container: HTMLElement, app: App, lifecycle: ProviderCliLifecyclePort,
  options: { updatesOnly?: boolean; onDismiss?: () => void } = {},
): () => void {
  const mount = container.createDiv({ cls: 'claudian-cli-updates-mount' });
  const root = createPreactRoot(mount);
  const snapshots = new Map(lifecycle.getSnapshots().map(snapshot => [snapshot.providerId, snapshot]));
  const shown = new Set([...snapshots.values()].filter(snapshot => snapshot.canUpdate).map(snapshot => snapshot.providerId));
  let destroyed = false;
  let preparing = false;
  let error: string | null = null;
  const render = (): void => {
    if (destroyed) return;
    root.render(h(ProviderCliUpdatesView, {
      snapshots: [...snapshots.values()].filter(snapshot => !options.updatesOnly || shown.has(snapshot.providerId)),
      preparing, error, onUpdate: targets => { void update(targets); },
      onCheck: () => { void check(); },
      onDismiss: options.onDismiss,
    }));
  };
  const check = async (): Promise<void> => {
    preparing = true;
    error = null;
    render();
    try { await lifecycle.checkEnabled({ force: true }); }
    catch (cause) { error = cause instanceof Error ? cause.message : t('common.error'); }
    finally { preparing = false; render(); }
  };
  const update = async (targets: readonly ProviderCliSnapshot[]): Promise<void> => {
    if (preparing) return;
    preparing = true;
    error = null;
    render();
    try {
      const plans = [];
      for (const target of targets) plans.push(await lifecycle.prepareAction(target.providerId, 'update'));
      if (destroyed) return;
      const commands = plans.map(plan => [plan.command.command, ...plan.command.args].join(' ')).join('\n');
      const { confirm } = await import('@/shared/modals/ConfirmModal');
      if (destroyed) return;
      const accepted = await confirm(app, t('settings.cliUpdates.confirmAll', { commands }), t('settings.cliLifecycle.update'));
      if (!accepted || destroyed) return;
      // Once accepted, the batch continues even if its presentation is dismissed.
      for (const plan of plans) await lifecycle.executeAction(plan);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : t('common.error');
    } finally {
      preparing = false;
      render();
    }
  };
  const unsubscribe = lifecycle.subscribe(snapshot => {
    if (destroyed) return;
    snapshots.set(snapshot.providerId, snapshot);
    if (snapshot.canUpdate) shown.add(snapshot.providerId);
    render();
  });
  render();
  void lifecycle.checkEnabled().catch(() => undefined);
  return () => {
    destroyed = true;
    unsubscribe();
    root.unmount();
    mount.remove();
  };
}

/** Startup is a transient invitation; the review surface owns detailed presentation. */
export async function showProviderCliUpdates(app: App, lifecycle: ProviderCliLifecyclePort): Promise<() => void> {
  const updates = (await lifecycle.checkEnabled()).filter(snapshot => snapshot.enabled && snapshot.canUpdate);
  if (!updates.length) return () => undefined;
  const fragment = createFragment();
  const container = createDiv();
  fragment.appendChild(container);
  const root = createPreactRoot(container);
  let disposed = false;
  let opening = false;
  let modal: Modal | null = null;
  const notice = new Notice(fragment, 8000);
  const review = async (): Promise<void> => {
    if (disposed || opening) return;
    opening = true;
    try {
      const { ProviderCliUpdatesModal } = await import('./ProviderCliUpdatesModal');
      if (disposed) return;
      modal = new ProviderCliUpdatesModal(app, lifecycle);
      modal.open();
      root.unmount();
      notice.hide();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : t('common.error'));
    } finally {
      opening = false;
    }
  };
  root.render(h(ProviderCliUpdateNoticeView, {
    count: updates.length,
    onReview: () => { void review(); },
  }));
  return () => {
    disposed = true;
    modal?.close();
    root.unmount();
    notice.hide();
  };
}
