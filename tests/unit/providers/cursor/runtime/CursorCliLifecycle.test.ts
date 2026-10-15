import type { ProviderHost } from '@/core/providers/ProviderHost';
import { cursorCliLifecycle } from '@/providers/cursor/runtime/CursorCliLifecycle';

describe('Cursor CLI identity', () => {
  it('rejects Grok help even when it mentions ACP and Cursor workers', async () => {
    const target = await cursorCliLifecycle.resolveTarget({
      app: { vault: { adapter: { basePath: '/vault' } } },
      getResolvedProviderCliPath: async () => process.execPath,
      getActiveEnvironmentVariables: () => '',
    } as unknown as ProviderHost);

    // Sanitized excerpts from Grok Build 1.0.50 and Cursor 2026.08.11 help.
    expect(target?.identityPattern?.test(
      'Grok Build TUI\nNDJSON: one ACP session update per line\n'
      + 'cursor-worker  Register this machine as a Cursor private worker',
    )).toBe(false);
    expect(target?.identityPattern?.test('Start the Cursor Agent\nUsage: agent [options]')).toBe(true);
  });
});
