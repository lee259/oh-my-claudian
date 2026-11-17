import { getAvailableLocales, setLocale } from '@/i18n/i18n';
import { antigravityChatUIConfig } from '@/providers/antigravity/AntigravityModelPolicy';

describe('Antigravity permission modes', () => {
  afterEach(() => { setLocale('en'); });

  it('describes its own modes without another provider name in every locale', () => {
    for (const locale of getAvailableLocales()) {
      expect(setLocale(locale)).toBe(true);
      const options = antigravityChatUIConfig.getPermissionModeOptions?.({}) ?? [];

      expect(options).toHaveLength(4);
      for (const option of options) {
        expect(option.label.toLowerCase()).not.toContain('grok');
        expect(option.description?.toLowerCase() ?? '').not.toContain('grok');
      }
    }
  });
});
