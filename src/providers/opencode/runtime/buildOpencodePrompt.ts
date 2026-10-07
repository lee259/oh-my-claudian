import type { ChatMessage, ImageAttachment } from '../../../core/types';
import {
  appendBrowserContext,
  type BrowserSelectionContext,
} from '../../../utils/browser';
import {
  appendCanvasContext,
  type CanvasSelectionContext,
} from '../../../utils/canvas';
import { appendContextFiles } from '../../../utils/context';
import {
  appendCurrentNote,
  appendCurrentNoteContent,
} from '../../../utils/context';
import {
  appendEditorContext,
  type EditorSelectionContext,
} from '../../../utils/editor';
import { buildContextFromHistory, buildPromptWithHistoryContext } from '../../../utils/session';
import type { AcpContentBlock } from '../../acp';

export interface OpencodePromptRequest {
  text: string;
  images?: ImageAttachment[];
  currentNotePath?: string;
  currentNoteContent?: string;
  editorSelection?: EditorSelectionContext | null;
  browserSelection?: BrowserSelectionContext | null;
  canvasSelection?: CanvasSelectionContext | null;
  externalContextPaths?: string[];
  contextFiles?: string[];
}

/** The span of the composed prompt that came directly from the user's input. */
export interface OpencodeTextRange {
  readonly start: number;
  readonly end: number;
}

export interface OpencodePrompt {
  readonly blocks: AcpContentBlock[];
  readonly userText: OpencodeTextRange | null;
}

export function buildOpencodePromptText(
  request: OpencodePromptRequest,
  conversationHistory: ChatMessage[] = [],
  historyContextOverride?: string,
): string {
  return composeOpencodePromptText(request, conversationHistory, historyContextOverride).text;
}

function composeOpencodePromptText(
  request: OpencodePromptRequest,
  conversationHistory: ChatMessage[],
  historyContextOverride?: string,
): { text: string; userText: OpencodeTextRange | null } {
  let prompt = request.text;

  if (request.currentNotePath) {
    prompt = request.currentNoteContent === undefined
      ? appendCurrentNote(prompt, request.currentNotePath)
      : appendCurrentNoteContent(
        prompt,
        request.currentNotePath,
        request.currentNoteContent,
      );
  }

  if (request.editorSelection && request.editorSelection.mode !== 'none') {
    prompt = appendEditorContext(prompt, request.editorSelection);
  }

  if (request.browserSelection) {
    prompt = appendBrowserContext(prompt, request.browserSelection);
  }

  if (request.canvasSelection) {
    prompt = appendCanvasContext(prompt, request.canvasSelection);
  }
  if (request.contextFiles?.length) {
    prompt = appendContextFiles(prompt, request.contextFiles);
  }

  let text = prompt;
  if (conversationHistory.length > 0) {
    const historyContext = historyContextOverride ?? buildContextFromHistory(conversationHistory);
    text = buildPromptWithHistoryContext(
      historyContext,
      prompt,
      prompt,
      conversationHistory,
    );
  }

  let start: number;
  if (text === prompt) {
    start = 0;
  } else if (text.endsWith(`\n\nUser: ${prompt}`)) {
    start = text.length - prompt.length;
  } else {
    return { text, userText: null };
  }
  return {
    text,
    userText: { start, end: start + request.text.length },
  };
}

export function buildOpencodePrompt(
  request: OpencodePromptRequest,
  conversationHistory: ChatMessage[] = [],
  historyContextOverride?: string,
): OpencodePrompt {
  const composed = composeOpencodePromptText(request, conversationHistory, historyContextOverride);
  const blocks: AcpContentBlock[] = [
    {
      type: 'text',
      text: composed.text,
    },
  ];

  for (const image of request.images ?? []) {
    if (!image.data) {
      continue;
    }

    blocks.push({
      data: image.data,
      mimeType: image.mediaType,
      type: 'image',
    });
  }

  return { blocks, userText: composed.userText };
}

export function buildOpencodePromptBlocks(
  request: OpencodePromptRequest,
  conversationHistory: ChatMessage[] = [],
  historyContextOverride?: string,
): AcpContentBlock[] {
  return buildOpencodePrompt(request, conversationHistory, historyContextOverride).blocks;
}
