import {
  DEFAULT_DSH_PROVIDER_SETTINGS,
  getConfiguredDshCliPath,
  getDshProviderSettings,
  updateDshProviderSettings,
} from '../../../../src/providers/dsh/settings';

describe('DeepSeek Harness settings', () => {
  it('prefers the host-specific executable path over the legacy configured path', () => {
    expect(getConfiguredDshCliPath({
      providerConfigs: {
        dsh: {
          cliPath: '/legacy/dsh',
          cliPathsByHost: { workstation: '/custom/dsh' },
        },
      },
    }, 'workstation')).toBe('/custom/dsh');
  });

  it('defaults to disabled without a discovered model or probe session', () => {
    expect(DEFAULT_DSH_PROVIDER_SETTINGS).toMatchObject({
      catalogSessionId: '',
      discoveredModels: [],
      enabled: false,
      visibleModels: [],
    });
  });

  it('normalizes catalog session ids and keeps provider settings merged', () => {
    const settings = {
      providerConfigs: {
        dsh: {
          catalogSessionId: ' catalog-session ',
          discoveredModels: [{ rawId: 'deepseek/deepseek-v4', label: 'DeepSeek V4' }],
          enabled: true,
          visibleModels: ['deepseek/deepseek-v4'],
        },
      },
    };

    expect(getDshProviderSettings(settings)).toMatchObject({
      catalogSessionId: 'catalog-session',
      enabled: true,
      visibleModels: ['deepseek/deepseek-v4'],
    });
    updateDshProviderSettings(settings, { catalogSessionId: 'next-session' });
    expect(getDshProviderSettings(settings)).toMatchObject({
      catalogSessionId: 'next-session',
      enabled: true,
      visibleModels: ['deepseek/deepseek-v4'],
    });
  });

  it('clears stale npm and npx entries from command path settings', () => {
    expect(getDshProviderSettings({
      providerConfigs: {
        dsh: {
          cliPath: '/Users/me/.node/bin/npx',
          cliPathsByHost: {
            'host-a': '/Users/me/.node/bin/npm',
            'host-b': '/custom/bin/dsh',
          },
        },
      },
    })).toMatchObject({
      cliPath: '',
      cliPathsByHost: { 'host-b': '/custom/bin/dsh' },
    });
  });
});
