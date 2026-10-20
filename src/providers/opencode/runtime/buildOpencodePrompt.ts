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
import { buildOpencodeRecoveryPrompt } from './OpencodeRecoveryPrompt';

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

  if (conversationHistory.length === 0) {
    return { text: prompt, userText: { start: 0, end: request.text.length } };
  }
  let historyContext = historyContextOverride ?? buildContextFromHistory(conversationHistory);
  const replay = buildPromptWithHistoryContext(historyContext, prompt, prompt, conversationHistory);
  const alreadyIncluded = replay === historyContext;
  const currentSuffix = `User: ${prompt}`;
  if (alreadyIncluded && historyContext.endsWith(currentSuffix)) {
    historyContext = historyContext.slice(0, -currentSuffix.length).trimEnd();
  }
  const recovered = buildOpencodeRecoveryPrompt(historyContext, prompt);
  return {
    text: recovered.text,
    userText: alreadyIncluded ? null : {
      start: recovered.promptStart,
      end: recovered.promptStart + request.text.length,
    },
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
