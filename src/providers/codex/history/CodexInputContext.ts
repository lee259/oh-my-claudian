import type { ExecutionInputContextSnapshot, ExecutionInputSnapshot } from '@/core/types';
import { extractContentBeforeXmlContext } from '@/utils/context';
import { decodePromptXmlAttribute } from '@/utils/promptXml';

interface ContextElement {
  tag: string;
  attributes: Record<string, string>;
  content?: string;
  length: number;
}

function readElement(source: string): ContextElement | undefined {
  const opening = /^<(linked_note|current_note|context_files|context_file|editor_selection|browser_selection|editor_cursor|canvas_selection)\b([^>]*?)(\/>|>)/.exec(source);
  if (!opening) return undefined;
  const attributes = Object.create(null) as Record<string, string>;
  let remaining = opening[2].trim();
  while (remaining) {
    const attribute = /^([a-z_]+)="([^"]*)"(?:\s+|$)/.exec(remaining);
    if (!attribute || Object.hasOwn(attributes, attribute[1])) return undefined;
    attributes[attribute[1]] = decodePromptXmlAttribute(attribute[2]);
    remaining = remaining.slice(attribute[0].length);
  }
  const element = { tag: opening[1], attributes, length: opening[0].length };
  if (opening[3] === '/>') return element;
  const closing = `</${element.tag}>`;
  let index = source.indexOf('<', element.length);
  while (index >= 0) {
    if (source.startsWith('<![CDATA[', index)) {
      const end = source.indexOf(']]>', index + 9);
      if (end < 0) return undefined;
      index = source.indexOf('<', end + 3);
    } else if (source.startsWith(closing, index)) {
      return { ...element, content: source.slice(element.length, index), length: index + closing.length };
    } else index = source.indexOf('<', index + 1);
  }
  return undefined;
}

function readSelection(content: string | undefined): string | undefined {
  if (content === undefined) return undefined;
  const body = content.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  if (!body.startsWith('<![CDATA[')) return /[<>]/.test(body) ? undefined : body;
  let remaining = body;
  let text = '';
  while (remaining.startsWith('<![CDATA[')) {
    const end = remaining.indexOf(']]>', 9);
    if (end < 0) return undefined;
    text += remaining.slice(9, end);
    remaining = remaining.slice(end + 3);
  }
  return remaining ? undefined : text;
}

export function recoverCodexInputContext(text: string): ExecutionInputSnapshot | undefined {
  // Native user-text normalization trims the separator from context-only input.
  const canonicalText = extractContentBeforeXmlContext(text.startsWith('<') ? `\n\n${text}` : text);
  const source = text.trimStart();
  if (canonicalText === undefined || !source.startsWith(canonicalText)) return undefined;
  let remaining = source.slice(canonicalText.length).trimStart();
  const context: ExecutionInputContextSnapshot = {};
  const files = new Set<string>();
  while (remaining) {
    const element = readElement(remaining);
    if (!element) return undefined;
    const { tag, attributes, content } = element;
    const notePath = attributes.path;
    if (tag === 'linked_note' || tag === 'current_note') {
      if (!notePath?.trim() || (context.currentNote && context.currentNote.path !== notePath)) return undefined;
      context.currentNote = { path: notePath };
    } else if (tag === 'context_files') {
      if (content === undefined) return undefined;
      let entries = content.trim();
      while (entries) {
        const file = readElement(entries);
        if (file?.tag !== 'context_file' || file.content !== undefined || !file.attributes.path?.trim()) return undefined;
        files.add(file.attributes.path);
        entries = entries.slice(file.length).trimStart();
      }
    } else if (tag === 'editor_selection') {
      const selectedText = readSelection(content);
      if (!notePath?.trim() || !selectedText || context.editorSelection) return undefined;
      const lines = /^([1-9]\d*)-([1-9]\d*)$/.exec(attributes.lines ?? '');
      const start = Number(lines?.[1]);
      const end = Number(lines?.[2]);
      const validRange = Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start;
      context.editorSelection = {
        mode: 'selection', notePath, selectedText,
        ...(validRange ? { startLine: start, lineCount: end - start + 1 } : {}),
      };
    } else if (tag === 'browser_selection') {
      const selectedText = readSelection(content);
      if (!attributes.source?.trim() || !selectedText || context.browserSelection) return undefined;
      context.browserSelection = {
        source: attributes.source, selectedText,
        ...(attributes.title ? { title: attributes.title } : {}),
        ...(attributes.url ? { url: attributes.url } : {}),
      };
    } else if (tag !== 'editor_cursor' && tag !== 'canvas_selection') return undefined;
    remaining = remaining.slice(element.length).trimStart();
  }
  if (files.size > 0) context.contextFiles = [...files];
  return Object.keys(context).length > 0 ? { schemaVersion: 1, canonicalText, context } : undefined;
}
