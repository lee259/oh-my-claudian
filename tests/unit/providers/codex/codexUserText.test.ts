import {
  extractCodexUserVisibleText,
  joinCodexUserTextParts,
  stripCodexImagePlaceholderText,
} from '@/providers/codex/codexUserText';

describe('codexUserText', () => {
  it('strips inline generated image placeholder tags', () => {
    expect(
      stripCodexImagePlaceholderText('<image name=[Image #1] path="/tmp/1-image-1.png"></image>what was in this img?'),
    ).toBe('what was in this img?');
  });

  it('strips generated image placeholder tags split across text parts', () => {
    expect(
      joinCodexUserTextParts([
        '<image name=[Image #1] path="/tmp/1-image-1.png">',
        '</image>',
        'what was in this img?',
      ], '\n\n'),
    ).toBe('what was in this img?');
  });

  it('hides native async question reply payloads from user-visible text', () => {
    const protocol = '<send_user_message_question_reply>\n[{"questionItemId":"[\\"request_user_input_async\\",\\"call\\",0]","question":"Which?","answer":"History"}]\n</send_user_message_question_reply>';
    expect(extractCodexUserVisibleText(protocol)).toBeNull();
    expect(extractCodexUserVisibleText(`Visible context\n${protocol}`)).toBe('Visible context');
  });
});
