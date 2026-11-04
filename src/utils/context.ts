/**
 * Oh My Claudian - Context Utilities
 *
 * Note and context file formatting for prompts.
 */

import { parser } from '@lezer/markdown';

import { escapePromptXmlAttribute, formatPromptXmlCdata } from './promptXml';

const LINKED_NOTE_TAG = 'linked_note';
const NOTE_CONTEXT_TAG_PATTERN = '(linked_note|current_note)';
const SELF_CLOSING_NOTE_CONTEXT_PATTERN = '<(?:linked_note|current_note)(?:\\s[^>]*)?\\s*/>';
const PAIRED_NOTE_CONTEXT_PATTERN = `<${NOTE_CONTEXT_TAG_PATTERN}(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1>`;
const NOTE_CONTEXT_BLOCK_PATTERN = `(?:${SELF_CLOSING_NOTE_CONTEXT_PATTERN}|${PAIRED_NOTE_CONTEXT_PATTERN})`;

// Matches note context at the START of prompt (legacy placement)
const NOTE_CONTEXT_PREFIX_REGEX = new RegExp(`^${NOTE_CONTEXT_BLOCK_PATTERN}\\n\\n`);
// Matches note context at the END of prompt (current placement)
const NOTE_CONTEXT_SUFFIX_REGEX = new RegExp(`\\n\\n${NOTE_CONTEXT_BLOCK_PATTERN}$`);

/**
 * Pattern to match XML context tags appended to prompts.
 * These tags are always preceded by \n\n separator.
 * Matches: linked_note/current_note, editor_selection (with attributes), editor_cursor (with attributes),
 * context_files, canvas_selection, browser_selection
 */
export const XML_CONTEXT_PATTERN = /\n\n<(?:linked_note|current_note|editor_selection|editor_cursor|context_files|canvas_selection|browser_selection)[\s>]/;
const BRACKET_CONTEXT_PATTERN = /\n\[(?:Current note|Editor selection from|Browser selection from|Canvas selection from)\b/;

/** Only closed Markdown literals protect examples; unclosed fence behavior stays unchanged. */
function getClosedCodeRanges(text: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  parser.parse(text).iterate({
    enter(node) {
      if (node.name !== 'InlineCode' && node.name !== 'FencedCode') return;
      if (node.node.getChildren('CodeMark').length === 2) ranges.push({ from: node.from, to: node.to });
      return false;
    },
  });
  return ranges;
}

function findContextBoundary(text: string, pattern: RegExp): number {
  let ranges: ReturnType<typeof getClosedCodeRanges> | undefined;
  for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
    ranges ??= getClosedCodeRanges(text);
    if (!ranges.some(range => match.index < range.to && match.index + match[0].length > range.from)) {
      return match.index;
    }
  }
  return -1;
}

/** Keep literal openers searchable without hiding a later real context match. */
function stripContextOutsideCode(text: string, pattern: RegExp): string {
  let match = pattern.exec(text);
  if (!match) return text;
  const ranges = getClosedCodeRanges(text);
  let result = '';
  let cursor = 0;
  while (match) {
    const index = match.index;
    if (ranges.some(range => index >= range.from && index < range.to)) {
      // A literal opener's match may include a real outside closer; retry from the next character.
      pattern.lastIndex = match.index + 1;
    } else {
      result += text.slice(cursor, match.index);
      cursor = pattern.lastIndex;
    }
    match = pattern.exec(text);
  }
  return result + text.slice(cursor);
}

export function formatCurrentNote(notePath: string): string {
  return `<${LINKED_NOTE_TAG} path="${escapePromptXmlAttribute(notePath)}" />`;
}

export function appendCurrentNote(prompt: string, notePath: string): string {
  return `${prompt}\n\n${formatCurrentNote(notePath)}`;
}

export function formatCurrentNoteContent(notePath: string, content: string): string {
  return `<current_note path="${escapePromptXmlAttribute(notePath)}">\n${formatPromptXmlCdata(
    content,
  )}\n</current_note>`;
}

export function appendCurrentNoteContent(
  prompt: string,
  notePath: string,
  content: string,
): string {
  return `${prompt}\n\n${formatCurrentNoteContent(notePath, content)}`;
}

/**
 * Strips note context from a prompt.
 * Handles legacy <current_note> tags and canonical <linked_note> tags.
 */
export function stripCurrentNoteContext(prompt: string): string {
  const strippedPrefix = prompt.replace(NOTE_CONTEXT_PREFIX_REGEX, '');
  if (strippedPrefix !== prompt) {
    return strippedPrefix;
  }
  return prompt.replace(NOTE_CONTEXT_SUFFIX_REGEX, '');
}

/**
 * Extracts user content that appears before XML context tags.
 * Handles two formats:
 * 1. Legacy: content inside <query> tags
 * 2. Current: user content first, context XML appended after
 */
export function extractContentBeforeXmlContext(text: string): string | undefined {
  if (!text) return undefined;

  // Legacy format: content inside <query> tags
  const queryMatch = text.match(/<query>\n?([\s\S]*?)\n?<\/query>/);
  if (queryMatch) {
    return queryMatch[1].trim();
  }

  // Current format: user content before any XML context tags
  // Context tags are always appended with \n\n separator
  const boundary = findContextBoundary(text, XML_CONTEXT_PATTERN);
  if (boundary >= 0) return text.substring(0, boundary).trim();

  return undefined;
}

export function extractUserDisplayContent(text: string): string | undefined {
  if (!text) return undefined;

  const xmlDisplayContent = extractContentBeforeXmlContext(text);
  if (xmlDisplayContent !== undefined) {
    return xmlDisplayContent;
  }

  const boundary = findContextBoundary(text, BRACKET_CONTEXT_PATTERN);
  if (boundary >= 0) return text.substring(0, boundary).trim();

  return undefined;
}

/**
 * Extracts the actual user query from an XML-wrapped prompt.
 * Used for comparing prompts during history deduplication.
 *
 * Always returns a string - falls back to stripping all XML tags if no
 * structured context is found.
 */
export function extractUserQuery(prompt: string): string {
  if (!prompt) return '';

  // Try to extract content before XML context
  const extracted = extractContentBeforeXmlContext(prompt);
  if (extracted !== undefined) {
    return extracted;
  }

  // No XML context - return the whole prompt stripped of any remaining tags
  let query = prompt;
  for (const pattern of [
    /<(?:linked_note|current_note)(?:\s[^>]*)?\s*\/>\s*/g,
    /<(linked_note|current_note)(?:\s[^>]*)?>[\s\S]*?<\/\1>\s*/g,
    /<editor_selection[\s\S]*?<\/editor_selection>\s*/g,
    /<editor_cursor[\s\S]*?<\/editor_cursor>\s*/g,
    /<context_files>[\s\S]*?<\/context_files>\s*/g,
    /<canvas_selection[\s\S]*?<\/canvas_selection>\s*/g,
    /<browser_selection[\s\S]*?<\/browser_selection>\s*/g,
  ]) query = stripContextOutsideCode(query, pattern);
  return query.trim();
}

function formatContextFilesLine(files: string[]): string {
  const entries = files
    .map(file => `<context_file path="${escapePromptXmlAttribute(file)}" />`)
    .join('\n');
  return `<context_files>\n${entries}\n</context_files>`;
}

export function appendContextFiles(prompt: string, files: string[]): string {
  return `${prompt}\n\n${formatContextFilesLine([...new Set(files)])}`;
}
