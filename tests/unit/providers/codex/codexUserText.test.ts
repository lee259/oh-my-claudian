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

  it('preserves literal image markup inside code examples', () => {
    expect(stripCodexImagePlaceholderText('Example:\n```xml\n<image></image>\n```\nExplain it.'))
      .toBe('Example:\n```xml\n<image></image>\n```\nExplain it.');
    expect(stripCodexImagePlaceholderText('    <image></image>')).toBe('    <image></image>');
    expect(stripCodexImagePlaceholderText('Explain `<image></image>`; keep the literal tag.'))
      .toBe('Explain `<image></image>`; keep the literal tag.');
  });

  it('keeps code indentation when stripping a generated placeholder beside it', () => {
    expect(stripCodexImagePlaceholderText('Attachment <image></image>\n\n    <image></image>\n\nExplain the code.'))
      .toBe('Attachment \n\n    <image></image>\n\nExplain the code.');
  });

  it('hides native async question reply payloads from user-visible text', () => {
    const protocol = '<send_user_message_question_reply>\n[{"questionItemId":"[\\"request_user_input_async\\",\\"call\\",0]","question":"Which?","answer":"History"}]\n</send_user_message_question_reply>';
    expect(extractCodexUserVisibleText(protocol)).toBeNull();
    expect(extractCodexUserVisibleText(`Visible context\n${protocol}`)).toBe('Visible context');
  });
});
