import { cursorChatUIConfig } from '@/providers/cursor/ui/CursorChatUIConfig';

describe('Cursor chat permission modes', () => {
  it('declares the Agent, Ask, and Plan modes supported by the ACP adapter', () => {
    expect(cursorChatUIConfig.getPermissionModeOptions?.({}).map(({ value, label, isPlanMode }) => ({
      value,
      label,
      isPlanMode: isPlanMode ?? false,
    }))).toEqual([
      { value: 'normal', label: 'Agent', isPlanMode: false },
      { value: 'ask', label: 'Ask', isPlanMode: false },
      { value: 'plan', label: 'Plan', isPlanMode: true },
    ]);
  });
});
