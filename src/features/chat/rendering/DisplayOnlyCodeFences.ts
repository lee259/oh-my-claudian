import { loadPrism } from 'obsidian';

import { transformMarkdownSegments } from '../../../utils/markdownSegments';

const PLACEHOLDER_LANGUAGE_PREFIX = 'claudian-display-only-fence-';

/** Fence languages Claudian renders instead of neutralizing, when the user opts in. */
export const DIAGRAM_FENCE_LANGUAGES: readonly string[] = ['mermaid'];

const FENCE_INFO_PATTERN = /^([\t ]*)(\S+)(.*)$/;

/** Reports whether streaming content already contains a diagram fence opener. */
export function hasDiagramFence(
  content: string,
  languages: readonly string[] = DIAGRAM_FENCE_LANGUAGES,
): boolean {
  const diagramLanguages = new Set(languages.map((language) => language.toLowerCase()));
  let found = false;

  transformMarkdownSegments(content, {
    fence: (_opener, fence) => {
      const languageMatch = fence.info.match(FENCE_INFO_PATTERN);
      if (languageMatch && diagramLanguages.has(languageMatch[2].toLowerCase())) {
        found = true;
      }
      return _opener;
    },
  });

  return found;
}

interface PrismHighlighter {
  highlightElement(element: Element): void;
}

function isPrismHighlighter(value: unknown): value is PrismHighlighter {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as Record<string, unknown>).highlightElement === 'function';
}

export interface DisplayOnlyCodeFence {
  placeholderLanguage: string;
  originalLanguage: string;
}

export interface PreparedDisplayOnlyCodeFences {
  markdown: string;
  fences: DisplayOnlyCodeFence[];
}

export interface PrepareDisplayOnlyCodeFencesOptions {
  /** Languages whose code-block processor is allowed to run on chat content. */
  renderedLanguages?: readonly string[];
}

/** Replaces fence languages so Obsidian cannot dispatch registered code-block processors. */
export function prepareDisplayOnlyCodeFences(
  markdown: string,
  options?: PrepareDisplayOnlyCodeFencesOptions,
): PreparedDisplayOnlyCodeFences {
  const renderedLanguages = new Set(
    (options?.renderedLanguages ?? []).map((language) => language.toLowerCase()),
  );
  const fences: DisplayOnlyCodeFence[] = [];
  const preparedMarkdown = transformMarkdownSegments(markdown, {
    fence: (opener, fence) => {
      const languageMatch = fence.info.match(FENCE_INFO_PATTERN);
      if (!languageMatch) {
        return opener;
      }

      const originalLanguage = languageMatch[2];
      if (renderedLanguages.has(originalLanguage.toLowerCase())) {
        return opener;
      }

      const placeholderLanguage = `${PLACEHOLDER_LANGUAGE_PREFIX}${fences.length}`;
      fences.push({ placeholderLanguage, originalLanguage });

      const transformedInfo = `${languageMatch[1]}${placeholderLanguage}${languageMatch[3]}`;
      return opener.slice(0, fence.infoStart)
        + transformedInfo
        + opener.slice(fence.infoStart + fence.info.length);
    },
  });

  return { markdown: preparedMarkdown, fences };
}

/** Restores display metadata after Markdown post-processors finish, then highlights the code. */
export async function restoreDisplayOnlyCodeFences(
  container: HTMLElement,
  fences: readonly DisplayOnlyCodeFence[],
): Promise<void> {
  const codeBlocks: HTMLElement[] = [];

  for (const fence of fences) {
    const placeholderClass = `language-${fence.placeholderLanguage}`;
    const code = container.querySelector<HTMLElement>(`code.${placeholderClass}`);
    if (!code) {
      continue;
    }

    code.classList.remove(placeholderClass);
    code.classList.add(`language-${fence.originalLanguage}`);
    codeBlocks.push(code);
  }

  if (codeBlocks.length === 0) {
    return;
  }

  try {
    const prism: unknown = await loadPrism();
    if (!isPrismHighlighter(prism)) {
      return;
    }
    for (const code of codeBlocks) {
      prism.highlightElement(code);
    }
  } catch {
    // Language restoration is authoritative; highlighting is best-effort.
  }
}
