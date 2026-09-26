import { opencodeChatUIConfig } from '@/providers/opencode/ui/OpencodeChatUIConfig';

describe('OpenCode chat mode options', () => {
  it('shows only modes advertised by the OpenCode ACP session', () => {
    const settings = {
      providerConfigs: {
        opencode: {
          availableModes: [
            { description: 'Default coding agent', id: 'build', name: 'Build' },
            { description: 'Read-only planning agent', id: 'plan', name: 'Plan' },
          ],
          selectedMode: 'build',
        },
      },
    } as unknown as Record<string, unknown>;

    expect(opencodeChatUIConfig.getPermissionModeOptions?.(settings)).toEqual([
      expect.objectContaining({
        description: 'Default coding agent',
        label: 'Build',
        value: 'build',
      }),
      expect.objectContaining({
        description: 'Read-only planning agent',
        isPlanMode: true,
        label: 'Plan',
        value: 'plan',
      }),
    ]);
  });
});
