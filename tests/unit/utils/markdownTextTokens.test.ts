import { filterMarkdownTextTokens } from '@/utils/markdownTextTokens';

describe('filterMarkdownTextTokens', () => {
  it('filters tokens inside inline, fenced, and indented code', () => {
    const text = [
      'Use /skill:review here.',
      'Literal: `/skill:review`',
      '```md',
      '/skill:review',
      '```',
      '    /skill:review',
    ].join('\n');
    const tokens = [...text.matchAll(/(?<!\S)\/\S+/g)].map(match => ({
      index: match.index,
      fullMatch: match[0],
    }));

    expect(filterMarkdownTextTokens(text, tokens)).toEqual([tokens[0]]);
  });

  it('filters escaped tokens and tokens that cross a line break', () => {
    const text = '\\' + '/skill:review\n/skill:review';
    const tokens = [
      { index: 1, fullMatch: '/skill:review' },
      { index: 15, fullMatch: '/skill:\nreview' },
    ];

    expect(filterMarkdownTextTokens(text, tokens)).toEqual([]);
  });
});
