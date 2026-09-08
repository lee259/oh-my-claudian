import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';

describe('DEFAULT_CLAUDIAN_SETTINGS', () => {
  it('does not expose Mermaid rendering as a user preference', () => {
    expect('renderDiagramsInChat' in DEFAULT_CLAUDIAN_SETTINGS).toBe(false);
  });

  it('keeps Claudian system instructions opt-in by default', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.useClaudianSystemPrompt).toBe(false);
  });
});
