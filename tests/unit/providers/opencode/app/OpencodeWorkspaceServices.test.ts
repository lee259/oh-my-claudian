import { opencodeWorkspaceRegistration } from '@/providers/opencode/app/OpencodeWorkspaceServices';
import { OpencodeMetadataService } from '@/providers/opencode/metadata/OpencodeMetadataService';

function createPlugin(enabled: boolean): any {
  return {
    executionLifecycleRegistry: {
      registerTransitionHook: jest.fn(() => jest.fn()),
    },
    settings: {
      providerConfigs: {
        opencode: {
          availableModes: [],
          enabled,
        },
      },
    },
  };
}

describe('OpenCode workspace initialization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('discovers native modes in the background when an enabled provider has no cached modes', async () => {
    const loadCatalog = jest.spyOn(OpencodeMetadataService.prototype, 'loadCatalog')
      .mockResolvedValue(true);

    const services = await opencodeWorkspaceRegistration.initialize({
      plugin: createPlugin(true),
      vaultAdapter: {} as any,
    } as any);

    expect(loadCatalog).toHaveBeenCalledTimes(1);
    await services.dispose?.();
  });

  it('does not trigger catalog discovery for a disabled provider', async () => {
    const loadCatalog = jest.spyOn(OpencodeMetadataService.prototype, 'loadCatalog')
      .mockResolvedValue(true);

    const services = await opencodeWorkspaceRegistration.initialize({
      plugin: createPlugin(false),
      vaultAdapter: {} as any,
    } as any);

    expect(loadCatalog).not.toHaveBeenCalled();
    await services.dispose?.();
  });
});
