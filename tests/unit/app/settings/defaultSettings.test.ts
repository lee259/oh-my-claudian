import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';

describe('DEFAULT_CLAUDIAN_SETTINGS', () => {
  it('keeps Mermaid rendering opt-in because it uses Obsidian processors on model output', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.renderDiagramsInChat).toBe(false);
  });
});
