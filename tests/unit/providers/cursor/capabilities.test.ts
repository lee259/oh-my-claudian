import { CURSOR_PROVIDER_CAPABILITIES } from '@/providers/cursor/capabilities';

describe('Cursor capabilities', () => {
  it('exposes runtime provider commands', () => {
    expect(CURSOR_PROVIDER_CAPABILITIES.supportsProviderCommands).toBe(true);
  });
});
