import { formatConversationDirectoryTitle } from '@/features/chat/utils/conversationDirectoryTitle';

describe('formatConversationDirectoryTitle', () => {
  it('does not split a surrogate pair when truncating a title', () => {
    const title = `${'a'.repeat(76)}😀${'b'.repeat(10)}`;

    expect(formatConversationDirectoryTitle(title)).toBe(`${'a'.repeat(76)}...`);
  });
});
