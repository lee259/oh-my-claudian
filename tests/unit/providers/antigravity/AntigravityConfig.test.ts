import { getProviderConfig } from '@/core/providers/providerConfig';
import {
  DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
  getOrderedAntigravityVisibleModelIds,
} from '@/providers/antigravity/config';
import {
  getAntigravityProviderSettings,
  updateAntigravityProviderSettings,
} from '@/providers/antigravity/settings';

describe('Antigravity provider settings', () => {
  it('defaults to disabled with no selected models', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { antigravity: { ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS } },
    };

    const current = getAntigravityProviderSettings(settings);
    expect(current.enabled).toBe(false);
    expect(getOrderedAntigravityVisibleModelIds(current)).toEqual([]);
    expect(current.cliPath).toBe('');
  });

  it('persists model selection and host-scoped CLI paths', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { antigravity: { ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS } },
    };

    updateAntigravityProviderSettings(settings, {
      enabled: true,
      cliPathsByHost: { 'host-a': '/opt/agy' },
      visibleModels: ['gemini-4-argon'],
    });

    expect(getAntigravityProviderSettings(settings)).toMatchObject({
      cliPathsByHost: { 'host-a': '/opt/agy' },
      enabled: true,
      visibleModels: ['gemini-4-argon'],
    });
    expect(getProviderConfig(settings, 'antigravity')).toMatchObject({
      enabled: true,
      visibleModels: ['gemini-4-argon'],
    });
  });

  it('decodes malformed persisted values to safe defaults', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: {
        antigravity: {
          cliPath: 7,
          enabled: 'true',
          environmentHash: false,
          visibleModels: 'gemini-4-argon',
        },
      },
    };

    const current = getAntigravityProviderSettings(settings);
    expect(current.enabled).toBe(false);
    expect(current.cliPath).toBe('');
    expect(current.environmentHash).toBe('');
    expect(current.visibleModels).toBeNull();
  });
});
