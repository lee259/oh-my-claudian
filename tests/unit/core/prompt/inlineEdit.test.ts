import {
  buildInlineEditPrompt,
  getInlineEditSystemPrompt,
  parseInlineEditResponse,
} from '@/core/prompt/inlineEdit';

describe('getInlineEditSystemPrompt', () => {
  it('instructs agents to decode XML attribute paths exactly once', () => {
    const prompt = getInlineEditSystemPrompt();

    expect(prompt).toContain('Decode XML entities in an attribute value exactly once');
    expect(prompt).toContain('Do not decode CDATA content');
    expect(prompt).toContain('A &amp; B.md');
  });
});

describe('parseInlineEditResponse', () => {
  it('keeps the complete payload when the reply frame contains nested tags', () => {
    expect(parseInlineEditResponse(
      '<replacement>Use <replacement>inner</replacement> in the example.</replacement>',
    )).toEqual({ success: true, editedText: 'Use <replacement>inner</replacement> in the example.' });
    expect(parseInlineEditResponse(
      '<insertion>Add <insertion>inner</insertion> here.</insertion>',
    )).toEqual({ success: true, insertedText: 'Add <insertion>inner</insertion> here.' });
  });

  it('still parses a frame wrapped in surrounding prose', () => {
    expect(parseInlineEditResponse('Here it is: <replacement>done</replacement>')).toEqual({
      success: true,
      editedText: 'done',
    });
  });
});

describe('buildInlineEditPrompt', () => {
  it('serializes selection paths and bodies with canonical XML', () => {
    const prompt = buildInlineEditPrompt({
      instruction: 'Explain this',
      mode: 'selection',
      notePath: 'notes/"draft" & plan.md',
      selectedText: 'if (a < b && marker === "]]>") {\n</editor_selection>\n}',
      startLine: 2,
      lineCount: 3,
    });

    expect(prompt).toBe(
      'Explain this\n\n<editor_selection path="notes/&quot;draft&quot; &amp; plan.md" lines="2-4">\n<![CDATA[if (a < b && marker === "]]]]><![CDATA[>") {\n</editor_selection>\n}]]>\n</editor_selection>',
    );
  });

  it('preserves inline-edit cursor line metadata', () => {
    const prompt = buildInlineEditPrompt({
      instruction: 'Continue',
      mode: 'cursor',
      notePath: 'notes/"draft".md',
      cursorContext: {
        beforeCursor: 'left < right',
        afterCursor: ' && done',
        isInbetween: false,
        line: 4,
        column: 5,
      },
    });

    expect(prompt).toBe(
      'Continue\n\n<editor_cursor path="notes/&quot;draft&quot;.md" line="5">\n<![CDATA[left < right| && done #inline]]>\n</editor_cursor>',
    );
  });
});
