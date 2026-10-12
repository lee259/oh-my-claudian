import { parseSDKMessageToChat } from '@/providers/claude/history/sdkMessageParsing';

it('preserves native slash command arguments in replayed user text', () => {
  const message = parseSDKMessageToChat({
    type: 'user', uuid: 'command', timestamp: '2026-10-12T00:00:00Z',
    message: { content: '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>src/main.ts --strict</command-args>' },
  });
  expect(message?.displayContent).toBe('/review src/main.ts --strict');
});
