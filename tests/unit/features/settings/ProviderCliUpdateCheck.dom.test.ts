/** @jest-environment jsdom */

import { Notice } from 'obsidian';

import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import type { ProviderCliLifecyclePort, ProviderCliSnapshot } from '@/core/providers/cli/ProviderCliLifecycle';
import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';
import { mountProviderCliUpdateCheck } from '@/features/settings/ProviderCliUpdates';
import { ProviderCliUpdatesModal } from '@/features/settings/ProviderCliUpdatesModal';

jest.mock('@/features/settings/ProviderCliUpdatesModal', () => ({
  ProviderCliUpdatesModal: jest.fn(() => ({ open: jest.fn(), close: jest.fn() })),
}));

const snapshot: ProviderCliSnapshot = {
  providerId: 'test', enabled: true, displayName: 'Test', status: 'ready',
  path: '/private/agent', version: '1.0.0', latestVersion: '2.0.0',
  checkedAt: 1, error: null, canInstall: false, canUpdate: true,
};

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

HTMLElement.prototype.empty = function empty(): void {
  this.replaceChildren();
};

function createPort() {
  return {
    getSnapshots: jest.fn(() => [snapshot]), subscribe: jest.fn(() => () => undefined),
    checkEnabled: jest.fn(async () => [snapshot]),
  };
}

afterEach(() => jest.clearAllMocks());

it('preserves the compact update entry beside other general settings controls', () => {
  const port = createPort();
  const settings = { ...DEFAULT_CLAUDIAN_SETTINGS };
  const plugin = {
    settings, getAllViews: () => [], storage: { getAdapter: () => ({}) },
    getActiveEnvironmentVariables: () => '',
    providerHost: { settings, cliLifecycle: port, getEnvironmentVariablesForScope: () => '' },
  };
  const tab = new ClaudianSettingTab({} as never, plugin as never);
  tab.containerEl = document.createElement('div');
  tab.display();
  const setup = tab.containerEl.querySelector('[data-section-id="setup"]')!;
  expect(setup.querySelector('.claudian-cli-update-check-button')?.textContent).toBe('Check Agent updates');
  expect(setup.querySelector('select')).not.toBeNull();
  expect(tab.containerEl.querySelector('.claudian-cli-updates-list')).toBeNull();
  expect(port.checkEnabled).not.toHaveBeenCalled();
  tab.hide();
});

it('keeps general settings to one action and checks only after a click', async () => {
  const port = createPort();
  const container = document.createElement('div');
  const destroy = mountProviderCliUpdateCheck(container, {} as never, port as unknown as ProviderCliLifecyclePort);
  expect(container.querySelector('ul')).toBeNull();
  expect(container.textContent).not.toContain(snapshot.path);
  expect(container.textContent).not.toContain(snapshot.version);
  expect(port.checkEnabled).not.toHaveBeenCalled();
  expect(port.subscribe).not.toHaveBeenCalled();
  const button = container.querySelector('button')!;
  expect(button.textContent).toBe('Check Agent updates');
  button.click();
  button.click();
  expect(port.checkEnabled).toHaveBeenCalledTimes(1);
  expect(port.checkEnabled).toHaveBeenCalledWith({ force: true });
  await settle();
  expect(ProviderCliUpdatesModal).toHaveBeenCalledTimes(1);
  const modal = jest.mocked(ProviderCliUpdatesModal).mock.results[0].value;
  expect(modal.open).toHaveBeenCalledTimes(1);
  destroy();
  expect(modal.close).toHaveBeenCalledTimes(1);
  expect(container.childElementCount).toBe(0);
});

it('gives a short result when no enabled Agent needs an update', async () => {
  const port = createPort();
  port.checkEnabled.mockResolvedValue([{ ...snapshot, canUpdate: false }]);
  const container = document.createElement('div');
  const destroy = mountProviderCliUpdateCheck(container, {} as never, port as unknown as ProviderCliLifecyclePort);
  container.querySelector('button')!.click();
  await settle();
  expect(ProviderCliUpdatesModal).not.toHaveBeenCalled();
  expect(Notice).toHaveBeenCalledWith('No updates found for providers with an available version feed.');
  expect(container.querySelector('button')!.disabled).toBe(false);
  destroy();
});

it('does not open a modal after settings are closed during a check', async () => {
  const port = createPort();
  let finish!: (snapshots: ProviderCliSnapshot[]) => void;
  port.checkEnabled.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const container = document.createElement('div');
  const destroy = mountProviderCliUpdateCheck(container, {} as never, port as unknown as ProviderCliLifecyclePort);
  container.querySelector('button')!.click();
  destroy();
  finish([snapshot]);
  await settle();
  expect(ProviderCliUpdatesModal).not.toHaveBeenCalled();
});
