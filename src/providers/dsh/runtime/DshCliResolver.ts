import type { ProviderCliResolutionContext, ProviderCliResolver } from '../../../core/providers/types';
import { getHostnameKey } from '../../../utils/env';
import { getDshProviderSettings } from '../settings';

export class DshCliResolver implements ProviderCliResolver {
  resolveFromSettings(settings: Record<string, unknown>, _context?: ProviderCliResolutionContext): string | null {
    const provider = getDshProviderSettings(settings);
    return provider.cliPathsByHost[getHostnameKey()]
      || provider.cliPath
      || 'dsh';
  }

  reset(): void {}
}
