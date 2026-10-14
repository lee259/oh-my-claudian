/** @jest-environment jsdom */

import { Notice } from 'obsidian';

import type { ProviderCliLifecyclePort, ProviderCliSnapshot } from '@/core/providers/cli/ProviderCliLifecycle';
import { mountProviderCliUpdates, showProviderCliUpdates } from '@/features/settings/ProviderCliUpdates';
import { setLocale } from '@/i18n/i18n';

it('shows shared provider installation and update state in one surface', async () => {
  const snapshot: ProviderCliSnapshot = {
    providerId: 'test', enabled: true, displayName: 'Test', status: 'ready',
    path: '/custom/agent', version: '1.0.0', latestVersion: '2.0.0',
    checkedAt: 1, error: null, canInstall: false, canUpdate: true,
  };
  let listener: ((snapshot: ProviderCliSnapshot) => void) | undefined;
  const port = {
    getSnapshots: () => [snapshot],
    subscribe: (next: (snapshot: ProviderCliSnapshot) => void) => { listener = next; return () => { listener = undefined; }; },
    checkEnabled: async () => [snapshot],
  } as unknown as ProviderCliLifecyclePort;
  const container = document.createElement('div');
  const destroy = mountProviderCliUpdates(container, {} as never, port);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(container.textContent).toContain('Test');
  expect(container.textContent).toContain('1.0.0 → 2.0.0');
  expect(container.querySelector<HTMLDetailsElement>('.claudian-cli-updates-installation')?.open).toBe(false);
  snapshot.operation = { action: 'update', status: 'failed', error: 'Still on 1.0.0', verificationError: 'Expected 2.0.0, found 1.0.0',
    commandResult: { exitCode: 0, stdout: 'Updater: package manager owns this installation', stderr: 'Updater: nothing changed' } };
  listener?.(snapshot);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(container.textContent).toContain('Retry');
  expect(container.textContent).toContain('Updater: package manager owns this installation');
  expect(container.textContent).toContain('Updater: nothing changed');
  expect(container.textContent).toContain('Expected 2.0.0, found 1.0.0');
  expect(container.querySelector<HTMLDetailsElement>('.claudian-cli-operation-reply details')?.open).toBe(true);
  destroy();
  expect(listener).toBeUndefined();
  expect(container.childElementCount).toBe(0);
});


it.each([
  { locale: 'en' as const, message: 'Oh My Claudian: 1 agents have updates', review: 'Review updates' },
  { locale: 'zh-CN' as const, message: 'Oh My Claudian：1 个 Agent 有新版本', review: '查看更新' },
])('identifies the plugin in the compact $locale startup notice', async ({ locale, message, review }) => {
  const snapshot: ProviderCliSnapshot = { providerId: 'test', enabled: true, displayName: 'Test', status: 'ready',
    path: '/long/private/installation/agent', version: '1.0.0', latestVersion: '2.0.0', checkedAt: 1,
    error: null, canInstall: false, canUpdate: true };
  const port = { getSnapshots: () => [snapshot], checkEnabled: async () => [snapshot], subscribe: () => () => undefined } as unknown as ProviderCliLifecyclePort;
  const original = globalThis.createFragment;
  globalThis.createFragment = (() => {
    const fragment = document.createDocumentFragment();
    Object.assign(fragment, { createDiv: () => { const el = document.createElement('div'); fragment.append(el); return el; } });
    return fragment;
  }) as typeof createFragment;
  jest.mocked(Notice).mockImplementation(((fragment: DocumentFragment) => {
    const el = document.createElement('aside'); el.className = 'notice'; el.append(fragment); document.body.append(el);
    return { hide: () => el.remove() };
  }) as never);
  try {
    setLocale(locale);
    const dispose = await showProviderCliUpdates({} as never, port);
    const notice = document.querySelector('.notice')!;
    expect(notice.querySelector('.claudian-cli-update-notice-copy')?.textContent).toBe(message);
    expect(notice.querySelector('ul')).toBeNull();
    expect(notice.textContent).not.toContain(snapshot.path);
    expect(notice.textContent).not.toContain(snapshot.displayName);
    expect(notice.querySelector('button')?.textContent).toBe(review);
    expect(jest.mocked(Notice).mock.calls.at(-1)?.[1]).toBe(8000);
    dispose();
    expect(document.querySelector('.notice')).toBeNull();
  } finally {
    setLocale('en');
    globalThis.createFragment = original;
    jest.mocked(Notice).mockReset();
    document.body.replaceChildren();
  }
});
