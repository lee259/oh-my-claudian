import type { BrowserSelectionContext } from '../../utils/browser';
import type { CanvasSelectionContext } from '../../utils/canvas';
import type { EditorSelectionContext } from '../../utils/editor';
import type { ChatMessage, ImageAttachment } from '../types';

export type ProviderExecutionInputBlock =
  | {
      readonly type: 'text';
      readonly text: string;
    }
  | {
      readonly type: 'image';
      readonly image: ImageAttachment;
    };

export interface ProviderCurrentNoteContext {
  readonly path: string;
  readonly content?: string;
}

export interface ProviderExecutionContext {
  readonly currentNote?: ProviderCurrentNoteContext;
  readonly editorSelection?: EditorSelectionContext | null;
  readonly browserSelection?: BrowserSelectionContext | null;
  readonly canvasSelection?: CanvasSelectionContext | null;
  readonly externalContextPaths?: readonly string[];
  readonly contextFiles?: readonly string[];
}

export type ProviderSystemInstructions =
  | {
      readonly kind: 'none';
    }
  | {
      readonly kind: 'provider-default';
    }
  | {
      readonly kind: 'explicit';
      readonly instructions: string;
    };

export function resolveProviderSystemInstructions(
  instructions: ProviderSystemInstructions,
  buildDefault: () => string,
): string | undefined {
  switch (instructions.kind) {
    case 'none':
      return undefined;
    case 'explicit':
      return instructions.instructions;
    case 'provider-default':
      return buildDefault();
  }
}

export interface ProviderExecutionConfiguration {
  readonly systemInstructions: ProviderSystemInstructions;
  readonly model?: string;
  /** Null requests provider-default reasoning instead of an explicit override. */
  readonly reasoning?: string | null;
  readonly permissionMode?: string;
  readonly mode?: string;
  readonly serviceTier?: string;
  readonly enabledMcpServers?: readonly string[];
  readonly externalWorkspaceRoots?: readonly string[];
}

export type ProviderToolPolicy =
  | {
      readonly kind: 'passive';
    }
  | {
      readonly kind: 'read-only';
    }
  | {
      readonly kind: 'provider-default';
    }
  | {
      readonly kind: 'unrestricted';
    }
  | {
      readonly kind: 'allow-list';
      readonly names: readonly string[];
  };

export interface ProviderResolvedPromptDiagnostics {
  readonly source: 'configured' | 'provider';
  readonly characters: number;
  readonly sections: readonly {
    readonly name: string;
    readonly characters: number;
  }[];
}

export interface ProviderResolvedToolDiagnostics {
  readonly source: 'configured' | 'provider';
  readonly allowedNames?: readonly string[];
  readonly disallowedNames?: readonly string[];
  readonly enabledMcpServers?: readonly string[];
}

export interface ProviderResolvedHistoryDiagnostics {
  readonly budgetCharacters: number;
  readonly originalCharacters: number;
  readonly finalCharacters: number;
  readonly totalTurns: number;
  readonly includedTurns: number;
  readonly omittedTurns: number;
  readonly truncatedMessages: number;
  readonly wasCompacted: boolean;
}

/** Optional content-free diagnostics emitted after a provider resolves a request. */
export interface ProviderExecutionDiagnostics {
  readonly onResolved?: (diagnostics: {
    readonly prompt?: ProviderResolvedPromptDiagnostics;
    readonly turnPrompt?: ProviderResolvedPromptDiagnostics;
    readonly tools?: ProviderResolvedToolDiagnostics;
    readonly historyReplay?: ProviderResolvedHistoryDiagnostics;
  }) => void;
}

/**
 * Canonical provider-neutral input for one requested execution.
 *
 * Provider backends resolve their own settings at execution time and map this
 * desired configuration into their native protocol. This contract deliberately
 * carries no feature-purpose discriminator, provider credentials, environment,
 * or opaque provider settings bag.
 */
export interface ProviderExecutionRequest {
  readonly input: readonly ProviderExecutionInputBlock[];
  readonly context?: ProviderExecutionContext;
  readonly conversationHistory?: readonly ChatMessage[];
  readonly configuration: ProviderExecutionConfiguration;
  readonly toolPolicy: ProviderToolPolicy;
  readonly diagnostics?: ProviderExecutionDiagnostics;
  readonly signal: AbortSignal;
}
