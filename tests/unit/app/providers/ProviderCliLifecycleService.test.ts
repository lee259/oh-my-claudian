import type { ProviderCliLifecycleServiceOptions } from '@/app/providers/ProviderCliLifecycleService';
import { ProviderCliLifecycleService } from '@/app/providers/ProviderCliLifecycleService';
import type { ManagedCommandRequest, ManagedCommandResult } from '@/core/process/ManagedCommandRunner';
import { ManagedCommandRunner } from '@/core/process/ManagedCommandRunner';
import type { ProviderCliTarget } from '@/core/providers/cli/ProviderCliLifecycle';

function harness(overrides: Partial<ProviderCliLifecycleServiceOptions> = {}) {
  const target: ProviderCliTarget = {
    path: '/custom/agent',
    versionCommand: { command: '/custom/agent', args: ['--version'] },
    updateCommand: { command: '/custom/agent', args: ['update'] },
    environment: { PATH: '/custom/bin' },
    cwd: '/vault',
  };
  const run = jest.fn(async (_request: ManagedCommandRequest): Promise<ManagedCommandResult> => ({ exitCode: 0, stdout: 'agent 1.0.0' }));
  const service = new ProviderCliLifecycleService({
    providers: () => [{
      providerId: 'test', displayName: 'Test', enabled: true,
      metadata: { binaryName: 'agent', displayName: 'Test', npmPackage: 'test-agent' },
    }],
    resolveTarget: async () => target,
    resolveInstall: async () => null,
    resetResolver: async () => undefined,
    latestVersion: async () => '2.0.0',
    run,
    transition: async (_id, work) => work({ providerTransitionOwner: true }),
    refreshModels: async () => undefined,
    publishModels: async () => undefined,
    ...overrides,
  });
  return { service, run, target };
}

describe('ProviderCliLifecycleService', () => {
  it('uses a provider-owned release source when checking for updates', async () => {
    const latestRelease = jest.fn(async () => '2.0.0');
    const { service } = harness({ providers: () => [{
      providerId: 'test', displayName: 'Test', enabled: true,
      metadata: { binaryName: 'agent', displayName: 'Test', latestRelease },
    }] });
    expect(await service.check('test')).toMatchObject({ version: '1.0.0', latestVersion: '2.0.0', canUpdate: true });
    expect(latestRelease).toHaveBeenCalled();
    service.dispose();
  });

  it('shares a validated installation snapshot across consumers and respects its probe TTL', async () => {
    const { service, run } = harness();
    const observed: string[] = [];
    service.subscribe(snapshot => observed.push(snapshot.status));
    const [first, second] = await Promise.all([service.check('test'), service.check('test')]);
    expect(first).toMatchObject({
      path: '/custom/agent', version: '1.0.0', latestVersion: '2.0.0',
      status: 'ready', canUpdate: true,
    });
    expect(second).toEqual(first);
    expect(service.getSnapshot('test')).toEqual(first);
    expect(observed).toEqual(['checking', 'ready']);
    await service.check('test');
    expect(run).toHaveBeenCalledTimes(1);
    await service.check('test', { force: true });
    expect(run).toHaveBeenCalledTimes(2);
    service.dispose();
  });

  it('updates the configured target and keeps the accepted version target when registry access goes offline', async () => {
    const refreshModels = jest.fn(async () => undefined);
    const publishModels = jest.fn(async () => undefined);
    const latestVersion = jest.fn(async (): Promise<string | null> => '2.0.0');
    const { service, run } = harness({ refreshModels, publishModels, latestVersion });
    const plan = await service.prepareAction('test', 'update');
    latestVersion.mockResolvedValue(null);
    run.mockImplementation(async request => ({
      exitCode: 0, stdout: request.args[0] === '--version' ? 'agent 2.0.0' : '',
    }));
    const result = await service.executeAction(plan);
    expect(result).toMatchObject({ version: '2.0.0', operation: { status: 'verified' }, canUpdate: false });
    expect(run.mock.calls.some(([request]) =>
      request.command === '/custom/agent' && request.args[0] === 'update')).toBe(true);
    expect(refreshModels).toHaveBeenCalled();
    expect(publishModels).toHaveBeenCalled();
    await expect(service.executeAction(plan)).rejects.toThrow('already been used');
    service.dispose();
  });

  it.each(['', 'agent 1.0.0'])('does not report a verified update when the post-update version is %p', async output => {
    const { service, run } = harness();
    const plan = await service.prepareAction('test', 'update');
    run.mockResolvedValue({ exitCode: 0, stdout: output });
    const result = await service.executeAction(plan);
    expect(result.operation).toMatchObject({ status: 'failed', verificationError: expect.stringContaining('verification failed') });
    service.dispose();
  });

  it('returns the updater answer when its zero exit status leaves the installed version unchanged', async () => {
    const { service, run } = harness();
    const plan = await service.prepareAction('test', 'update');
    run.mockImplementation(async request => request.args[0] === 'update'
      ? { exitCode: 0, stdout: 'This installation is managed by npm. Run the package manager to update.', stderr: 'No changes made.' }
      : { exitCode: 0, stdout: 'agent 1.0.0' });
    const result = await service.executeAction(plan);
    expect(result.operation).toMatchObject({ status: 'failed', commandResult: {
      stdout: 'This installation is managed by npm. Run the package manager to update.', stderr: 'No changes made.', exitCode: 0,
    } });
    expect(result.operation?.error).toContain('No changes made.');
    service.dispose();
  });

  it('publishes a broken installation after an updater exits successfully but breaks its version probe', async () => {
    const { service, run } = harness();
    const plan = await service.prepareAction('test', 'update');
    run.mockResolvedValue({ exitCode: 0, stdout: '' });
    const result = await service.executeAction(plan);
    expect(result).toMatchObject({ status: 'broken', version: null, canUpdate: false, operation: { status: 'failed' } });
    expect(service.getSnapshot('test')).toMatchObject({ status: 'broken' });
    service.dispose();
  });

  it('rejects a changed installation after confirmation without executing an updater', async () => {
    const { service, run, target } = harness();
    const plan = await service.prepareAction('test', 'update');
    target.path = '/other/agent';
    const result = await service.executeAction(plan);
    expect(result.operation).toMatchObject({ status: 'failed', error: expect.stringContaining('target changed') });
    expect(run.mock.calls.some(([request]) => request.args[0] === 'update')).toBe(false);
    service.dispose();
  });

  it('keeps a verified installation visible when model refresh fails', async () => {
    const { service, run } = harness({ refreshModels: async () => { throw new Error('catalog unavailable'); } });
    const plan = await service.prepareAction('test', 'update');
    run.mockResolvedValue({ exitCode: 0, stdout: 'agent 2.0.0' });
    const result = await service.executeAction(plan);
    expect(result.operation).toMatchObject({ status: 'verified', warning: 'catalog unavailable' });
    service.dispose();
    await expect(service.check('test')).rejects.toThrow('disposed');
  });

  it('rejects replacement of the binary at the same configured path after confirmation', async () => {
    const { service, target, run } = harness();
    target.installationIdentity = 'original-file';
    const plan = await service.prepareAction('test', 'update');
    target.installationIdentity = 'replacement-file';
    const result = await service.executeAction(plan);
    expect(result.operation).toMatchObject({ status: 'failed' });
    expect(run.mock.calls.filter(([request]) => request.args[0] === 'update')).toHaveLength(0);
    service.dispose();
  });

  it('aborts an accepted updater on unload without publishing its late result or refreshing models', async () => {
    const refreshModels = jest.fn(async () => undefined);
    const { service, run } = harness({ refreshModels });
    const plan = await service.prepareAction('test', 'update');
    let finish!: (result: ManagedCommandResult) => void;
    run.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const listener = jest.fn();
    service.subscribe(listener);
    const operation = service.executeAction(plan);
    await Promise.resolve();
    await Promise.resolve();
    const request = run.mock.calls.at(-1)![0];
    service.dispose();
    expect(request.signal?.aborted).toBe(true);
    finish({ exitCode: 0, stdout: '' });
    await operation;
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ operation: { action: 'update', status: 'running' } }));
    expect(refreshModels).not.toHaveBeenCalled();
  });

  it('accepts a real CLI with help output longer than 8 KiB instead of terminating its identity probe', async () => {
    const { service, target } = harness({ run: request => new ManagedCommandRunner().run(request) });
    target.cwd = process.cwd();
    target.environment = process.env;
    target.identityCommand = { command: process.execPath, args: ['-e', "process.stdout.write('Pi coding agent --rpc\\n' + 'help documentation\\n'.repeat(1000))"] };
    target.identityPattern = /coding.agent|rpc/u;
    target.versionCommand = { command: process.execPath, args: ['-e', "process.stdout.write('1.1.0')"] };
    expect(await service.check('test')).toMatchObject({ status: 'ready', version: '1.1.0' });
    service.dispose();
  });

  it('rejects a mismatched provider identity before accepting a generic version number', async () => {
    const { service, target, run } = harness();
    target.identityCommand = { command: '/custom/agent', args: ['--help'] };
    target.identityPattern = /coding-agent/u;
    run.mockResolvedValue({ exitCode: 0, stdout: 'Unrelated tool 2.0.0' });
    expect(await service.check('test')).toMatchObject({ status: 'broken', canUpdate: false });
    expect(run).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  it('uses the installed major version feed and refreshes an expired cached miss', async () => {
    let clock = 0;
    let available = false;
    const latestVersion = jest.fn(async () => '2.1.0');
    const { service, target, run } = harness({
      now: () => clock,
      providers: () => [{ providerId: 'test', displayName: 'Test', enabled: true,
        metadata: { binaryName: 'agent', displayName: 'Test', npmPackage: 'v1-package', latestVersionNpmPackagesByMajor: { 2: 'v2-package' } } }],
      resolveTarget: async () => available ? target : null,
      latestVersion,
    });
    expect(await service.check('test')).toMatchObject({ status: 'missing' });
    available = true;
    run.mockResolvedValue({ exitCode: 0, stdout: 'agent 2.0.0' });
    expect(await service.check('test')).toMatchObject({ status: 'missing' });
    clock = 30_001;
    expect(await service.check('test')).toMatchObject({ status: 'ready', latestVersion: '2.1.0' });
    expect(latestVersion).toHaveBeenLastCalledWith('v2-package');
    service.dispose();
  });

});
