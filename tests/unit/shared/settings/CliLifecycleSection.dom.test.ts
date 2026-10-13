/** @jest-environment jsdom */

jest.mock('@/shared/modals/ConfirmModal', () => ({ confirm: jest.fn(async () => true) }));

import { ProviderCliLifecycleService } from '@/app/providers/ProviderCliLifecycleService';
import { confirm } from '@/shared/modals/ConfirmModal';
import { destroyCliLifecycleSections, renderCliLifecycleSection } from '@/shared/settings/CliLifecycleSection';

function setup(latest: string | null = '2.0.0') {
  let version = '1.0.0';
  let finishUpdate: (() => void) | undefined;
  const service = new ProviderCliLifecycleService({
    providers: () => [{ providerId: 'test', enabled: true, displayName: 'Test', metadata: { binaryName: 'agent', displayName: 'Test', npmPackage: 'test' } }],
    resolveTarget: async () => ({
      path: '/custom/agent', cwd: '/vault', environment: {},
      versionCommand: { command: '/custom/agent', args: ['--version'] },
      updateCommand: { command: '/custom/agent', args: ['update'] },
    }),
    resolveInstall: async () => null, resetResolver: async () => undefined,
    latestVersion: async () => latest,
    run: async request => {
      if (request.args[0] === 'update') {
        await new Promise<void>(resolve => { finishUpdate = resolve; });
        version = '2.0.0';
      }
      return { exitCode: 0, stdout: version };
    },
    transition: async (_id, work) => work({ providerTransitionOwner: true }),
    refreshModels: async () => undefined, publishModels: async () => undefined,
  });
  const mount = () => {
    const container = document.createElement('div');
    renderCliLifecycleSection({
      container, providerId: 'test', lifecycle: service,
      metadata: { binaryName: 'agent', displayName: 'Test' },
      resolveCliPath: async () => '/custom/agent', getRuntimeEnvText: () => '', app: {} as never,
    });
    return container;
  };
  return { service, mount, finish: () => finishUpdate?.() };
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('CLI lifecycle presentation', () => {
  it('confirms the exact configured command and retains the operation when settings close', async () => {
    const { service, mount, finish } = setup();
    const first = mount();
    await flush();
    expect(first.textContent).toContain('1.0.0');
    first.querySelector<HTMLButtonElement>('.claudian-cli-lifecycle-button')!.click();
    await flush();
    expect(confirm).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/custom/agent update'), 'Update');
    expect(service.getSnapshot('test')?.operation?.status).toBe('running');
    destroyCliLifecycleSections(first);
    const second = mount();
    await flush();
    expect(second.textContent).toContain('Updating');
    finish();
    await flush();
    expect(second.textContent).toContain('2.0.0');
    expect(second.textContent).toContain('CLI change verified.');
    destroyCliLifecycleSections(second);
    service.dispose();
  });

  it('does not claim the CLI is up to date when the version feed is unavailable', async () => {
    const { service, mount } = setup(null);
    const container = mount();
    await flush();
    expect(container.textContent).toContain('1.0.0');
    expect(container.querySelector('.claudian-cli-lifecycle-ready')).toBeNull();
    expect(container.querySelector('.claudian-cli-lifecycle-button:not(.claudian-cli-lifecycle-check)')).toBeNull();
    destroyCliLifecycleSections(container);
    service.dispose();
  });
});
