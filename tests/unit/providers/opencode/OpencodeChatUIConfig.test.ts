import { t } from '@/i18n/i18n';
import { getLocale, setLocale } from '@/i18n/i18n';
import { opencodeChatUIConfig } from '@/providers/opencode/ui/OpencodeChatUIConfig';

describe('OpenCode chat mode options', () => {
  it('shows only modes advertised by the OpenCode ACP session', () => {
    const settings = {
      providerConfigs: {
        opencode: {
          availableModes: [
            { description: 'Default coding agent', id: 'Build', name: 'Build' },
            { description: 'Read-only planning agent', id: 'Plan', name: 'Plan' },
          ],
          selectedMode: 'build',
        },
      },
    } as unknown as Record<string, unknown>;

    expect(opencodeChatUIConfig.getPermissionModeOptions?.(settings)).toEqual([
      expect.objectContaining({
        description: t('chat.composer.modeOpenCodeBuildDescription'),
        label: 'Build',
        value: 'Build',
      }),
      expect.objectContaining({
        description: t('chat.composer.modeOpenCodePlanDescription'),
        isPlanMode: true,
        label: 'Plan',
        value: 'Plan',
      }),
    ]);
  });

  it('keeps descriptions supplied for custom OpenCode agents', () => {
    const settings = {
      providerConfigs: {
        opencode: {
          availableModes: [
            { description: 'Reviews code against local conventions.', id: 'review', name: 'review' },
          ],
          selectedMode: 'review',
        },
      },
    } as unknown as Record<string, unknown>;

    expect(opencodeChatUIConfig.getPermissionModeOptions?.(settings)).toEqual([
      expect.objectContaining({
        description: 'Reviews code against local conventions.',
        label: 'review',
        value: 'review',
      }),
    ]);
  });

  it('localizes built-in mode presentation while preserving native agent IDs', () => {
    const previousLocale = getLocale();
    setLocale('zh-CN');
    try {
      const options = opencodeChatUIConfig.getPermissionModeOptions?.({
        providerConfigs: {
          opencode: {
            availableModes: [
              { description: 'The default agent.', id: 'Build', name: 'Build' },
              { description: 'Read-only agent.', id: 'Plan', name: 'Plan' },
            ],
          },
        },
      });

      expect(options).toEqual([
        expect.objectContaining({
          description: '按照 OpenCode 为此 agent 配置的权限使用工具。',
          label: '构建',
          value: 'Build',
        }),
        expect.objectContaining({
          description: '探索工作区并制定计划，不执行修改。',
          isPlanMode: true,
          label: '计划',
          value: 'Plan',
        }),
      ]);
    } finally {
      setLocale(previousLocale);
    }
  });
});
