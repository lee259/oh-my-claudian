import { getHostnameKey } from '../../utils/env';

/**
 * Oh My Claudian keys provider runtime state by hostname. Keep the newer
 * installation-key name as a compatibility alias for provider adapters that
 * still use the upstream terminology.
 */
export function getInstallationKey(): string {
  return getHostnameKey();
}
