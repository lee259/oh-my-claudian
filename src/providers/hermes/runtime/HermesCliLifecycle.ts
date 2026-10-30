import { requestUrl } from 'obsidian';

import type { CliProviderMetadata } from '@/core/providers/cli/CliProviderMetadata';
import { createHostCliLifecycleAdapter } from '@/core/providers/cli/HostCliLifecycleAdapter';

export async function fetchHermesLatestRelease(): Promise<string | null> {
  let timeoutId: number | undefined;
  try {
    const response = await Promise.race([
      requestUrl({ url: 'https://api.github.com/repos/NousResearch/hermes-agent/releases/latest', throw: false }),
      new Promise<never>((_resolve, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error('Request timed out')), 10_000);
      }),
    ]);
    if (response.status !== 200) return null;
    const data: unknown = response.json;
    if (!data || typeof data !== 'object' || !('tag_name' in data) || typeof data.tag_name !== 'string') return null;
    const match = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u.exec(data.tag_name);
    return match?.[1] ?? null;
  } catch { return null; } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

export const hermesCliMetadata: CliProviderMetadata = {
  binaryName: 'hermes', displayName: 'Hermes', latestRelease: fetchHermesLatestRelease,
  update: { command: 'hermes', args: ['update', '--yes'] },
  install: { command: 'bash', args: ['-lc', 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash'] },
  platform: { win32: { install: { command: 'powershell', args: ['-NoProfile', '-Command', "iex (irm 'https://hermes-agent.nousresearch.com/install.ps1')"] } } },
};
export const hermesCliLifecycle = createHostCliLifecycleAdapter('hermes', hermesCliMetadata, {
  identityPattern: /^Hermes Agent\b/imu,
});
