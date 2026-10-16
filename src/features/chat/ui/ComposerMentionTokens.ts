import { filterMarkdownTextTokens } from '@/utils/markdownTextTokens';

export interface ComposerFileMention {
  index: number;
  fullMatch: string;
  path: string;
  label: string;
}

/** Resolve full paths before deriving labels, so duplicate names never change identity. */
export function findComposerFileMentions(
  text: string,
  resolve: (path: string) => { path: string; name: string } | null,
): ComposerFileMention[] {
  const tokens: ComposerFileMention[] = [];
  for (const match of text.matchAll(/(^|\s)@(?=\S)/g)) {
    const index = match.index + match[1].length;
    if (tokens.some(token => index < token.index + token.fullMatch.length)) continue;
    const body = text.slice(index + 1).split(/[\r\n]/, 1)[0];
    const ends = new Set<number>([body.length]);
    for (let offset = 0; offset < body.length; offset++) {
      if (/[\s),.!?:;]/.test(body[offset])) ends.add(offset);
    }
    for (const end of [...ends].sort((a, b) => b - a)) {
      const path = body.slice(0, end);
      if (!path || path.endsWith('/') || /\s$/.test(path)) continue;
      const file = resolve(path);
      if (!file) continue;
      tokens.push({ index, fullMatch: `@${path}`, path: file.path, label: file.name.replace(/\.md$/i, '') });
      break;
    }
  }
  return filterMarkdownTextTokens(text, tokens);
}
