import type {
  ProviderCommandCatalog,
  ProviderCommandDropdownConfig,
} from './ProviderCommandCatalog';
import { normalizeProviderCommandDiscoveryItems } from './ProviderCommandDiscoveryResult';
import { ProviderCommandDiscoveryStore } from './ProviderCommandDiscoveryStore';
import type { ProviderCommandEntry } from './ProviderCommandEntry';

/** Maps a catalog deadline onto the discovery store. */
export function resolveCommandDiscoveryTimeoutMs(
  config: ProviderCommandDropdownConfig,
): number | null | undefined {
  return config.discoveryTimeoutMs === 'provider-owned'
    ? null
    : config.discoveryTimeoutMs;
}

/** Catalog-only discovery for surfaces without a chat session. */
export function createCatalogCommandDiscoveryStore(
  catalog: ProviderCommandCatalog,
): ProviderCommandDiscoveryStore<ProviderCommandEntry> {
  return new ProviderCommandDiscoveryStore(
    async signal => normalizeProviderCommandDiscoveryItems(
      await catalog.listDropdownEntries({ includeBuiltIns: false, signal }),
    ),
    {
      resolveTimeoutMs: () => resolveCommandDiscoveryTimeoutMs(
        catalog.getDropdownConfig(),
      ),
    },
  );
}
