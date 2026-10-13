/** @jest-environment jsdom */

import { h, render } from 'preact';

import { CliLifecycleView } from '@/shared/settings/CliLifecycleView';

it('keeps failed CLI output below the version and action overview', () => {
  const container = document.createElement('div');
  const onUpdate = jest.fn();
  render(h(CliLifecycleView, {
    info: { version: '18.5.0', latestVersion: '18.10.3', installedButBroken: false, error: null },
    statusText: '', canInstall: false, canUpdate: true, isUpdateAvailable: true, pendingAction: null,
    onInstall: jest.fn(), onUpdate, onCheckAgain: jest.fn(),
    operation: { action: 'update', status: 'failed', error: 'Version unchanged',
      verificationError: 'Expected 18.10.3, observed 18.5.0',
      commandResult: { exitCode: 0, stdout: 'Upstream: installation is managed externally', stderr: '' } },
  }), container);
  const overview = container.querySelector('.claudian-cli-lifecycle-overview');
  expect(overview?.textContent).toContain('18.5.0');
  expect(overview?.textContent).toContain('18.10.3');
  expect(overview?.querySelector('button')?.textContent).toBe('Update');
  expect(overview?.querySelector('.claudian-cli-operation-reply')).toBeNull();
  const reply = container.querySelector('.claudian-cli-operation-reply')!;
  expect(reply.previousElementSibling).toBe(overview);
  expect(reply.querySelector<HTMLDetailsElement>('details')?.open).toBe(true);
  expect(reply.textContent).toContain('Upstream: installation is managed externally');
  expect(container.querySelector('.mod-cta')).toBeNull();
  overview?.querySelector('button')?.click();
  expect(onUpdate).toHaveBeenCalledTimes(1);
});
