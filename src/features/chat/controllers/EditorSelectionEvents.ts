import type { EditorView, ViewUpdate } from '@codemirror/view';

export class EditorSelectionEvents {
  private listeners = new Set<(view: EditorView) => void>();

  subscribe(listener: (view: EditorView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(update: ViewUpdate): void {
    if (this.listeners.size === 0 || (!update.selectionSet && !update.docChanged)) return;
    queueMicrotask(() => {
      for (const listener of this.listeners) listener(update.view);
    });
  }
}

export const editorSelectionEvents = new EditorSelectionEvents();
