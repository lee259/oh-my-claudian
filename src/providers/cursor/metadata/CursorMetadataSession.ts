import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ProviderInteractionPort, ProviderSessionConfig } from '../../../core/execution';
import type { ProviderHost } from '../../../core/providers/ProviderHost';

const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/u;

export function getCursorMetadataSessionConfig(plugin: ProviderHost): ProviderSessionConfig {
  const adapter = plugin.app.vault.adapter as { basePath?: unknown };
  return {
    interactionPort: DENY_INTERACTION_PORT,
    lifecycle: 'ephemeral',
    nativePersistence: 'disabled-if-supported',
    vaultWorkingDirectory: typeof adapter.basePath === 'string' && adapter.basePath
      ? adapter.basePath
      : process.cwd(),
  };
}

const DENY_INTERACTION_PORT: ProviderInteractionPort = {
  askUserQuestion: async ({ interactionId }) => ({ answers: null, interactionId }),
  dismissInteraction: () => undefined,
  requestApproval: async ({ interactionId }) => ({ decision: 'deny', interactionId }),
  requestPlanDecision: async ({ interactionId }) => ({ decision: null, interactionId }),
};

/**
 * Removes a metadata probe's Cursor session folder only when it never received
 * a prompt (no transcript store), so real conversations are never touched.
 */
export async function removeUnusedCursorProbeSession(
  sessionId: string,
  home: string = os.homedir(),
): Promise<void> {
  if (!SAFE_SESSION_ID.test(sessionId)) return;
  const sessionDirectory = path.join(home, '.cursor', 'acp-sessions', sessionId);
  try {
    const entries = await fs.readdir(sessionDirectory);
    if (entries.some(entry => entry !== 'meta.json')) return;
    await fs.rm(sessionDirectory, { force: true, recursive: true });
  } catch {
    // Missing or unreadable probe sessions are left to Cursor.
  }
}
