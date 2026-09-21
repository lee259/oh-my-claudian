import {
  createCatalogCommandDiscoveryStore,
  resolveCommandDiscoveryTimeoutMs,
} from '@/core/providers/commands/catalogCommandDiscovery';
import type { ProviderCommandCatalog } from '@/core/providers/commands/ProviderCommandCatalog';

describe('catalogCommandDiscovery', () => {
  it('maps provider-owned discovery to no shared timeout', () => {
    expect(resolveCommandDiscoveryTimeoutMs({
      providerId: 'claude',
      triggerChars: ['/'],
      builtInPrefix: '/',
      skillPrefix: '/',
      commandPrefix: '/',
      discoveryTimeoutMs: 'provider-owned',
    })).toBeNull();
  });

  it('applies the catalog discovery deadline', async () => {
    jest.useFakeTimers();
    try {
      const catalog = {
        getDropdownConfig: () => ({
          providerId: 'claude',
          triggerChars: ['/'],
          builtInPrefix: '/',
          skillPrefix: '/',
          commandPrefix: '/',
          discoveryTimeoutMs: 100,
        }),
        listDropdownEntries: () => new Promise(() => undefined),
      } as unknown as ProviderCommandCatalog;
      const store = createCatalogCommandDiscoveryStore(catalog);

      const load = store.load();
      await jest.advanceTimersByTimeAsync(100);
      await load;

      expect(store.getSnapshot()).toEqual({
        status: 'error',
        message: 'Provider command discovery timed out',
        retryable: true,
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
