import type { ProviderCommandKind } from '@/core/providers/commands/ProviderCommandEntry';

/** Canonical text and selection shared by native inputs and the chat editor. */
export interface ComposerInputElement extends HTMLElement {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  placeholder: string;
  setSelectionRange(start: number, end: number, direction?: 'forward' | 'backward' | 'none'): void;
  setRangeText(replacement: string, start?: number, end?: number, selectionMode?: SelectionMode): void;
  replaceText?: (from: number, to: number, text: string) => void;
  getAccessibleTextbox?: () => HTMLElement;
  isCaretOnEdgeRow?: (direction: 'up' | 'down') => boolean | null;
  isChipRange?: (from: number, to: number) => boolean;
  setCommandResolver?: (resolve: ((token: string, atInputStart: boolean) => ProviderCommandKind | null) | null) => void;
}

export function getComposerTextbox(input: HTMLElement): HTMLElement {
  return (input as Partial<ComposerInputElement>).getAccessibleTextbox?.() ?? input;
}
