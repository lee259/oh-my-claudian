import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';

describe('DEFAULT_CLAUDIAN_SETTINGS', () => {
  it('does not expose Mermaid rendering as a user preference', () => {
    expect('renderDiagramsInChat' in DEFAULT_CLAUDIAN_SETTINGS).toBe(false);
  });

  it('enables Claudian system instructions by default', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.useClaudianSystemPrompt).toBe(true);
  });

  it('keeps provider diagnostic logging disabled with a default log directory', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.providerDiagnosticLogsEnabled).toBe(false);
    expect(DEFAULT_CLAUDIAN_SETTINGS.providerDiagnosticLogDirectory).toBe('');
  });
});
