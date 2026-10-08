import { parser } from '@lezer/markdown';

export function filterMarkdownTextTokens<T extends { index: number; fullMatch: string }>(
  text: string,
  tokens: T[],
  allowCodeInToken = false,
): T[] {
  const codeRanges: Array<{ from: number; to: number }> = [];
  parser.parse(text).iterate({
    enter(node) {
      if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeBlock') {
        codeRanges.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });

  return tokens.filter(token => {
    const precedingBackslashes = text.slice(0, token.index).match(/\\+$/)?.[0].length ?? 0;
    return precedingBackslashes % 2 === 0
      && !/[\r\n]/.test(token.fullMatch)
      && !codeRanges.some(range => token.index < range.to
        && (allowCodeInToken
          ? token.index >= range.from
          : token.index + token.fullMatch.length > range.from));
  });
}
