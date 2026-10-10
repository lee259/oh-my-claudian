import type { Command } from 'obsidian';

interface ChatFocusCommandDeps {
  getInputs: () => HTMLTextAreaElement[];
  getActiveDocument: () => Document | null;
  getPreferredInput: () => HTMLTextAreaElement | null;
}

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected || ('disabled' in element && element.disabled)) return false;
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = view.getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden'
      || style.visibility === 'collapse' || style.opacity === '0') return false;
  }
  return element.getClientRects().length > 0;
}

/** Toggle an existing, visible composer without changing view or conversation state. */
export function createChatFocusCommand(deps: ChatFocusCommandDeps): Command {
  const previousFocus = new WeakMap<HTMLTextAreaElement, HTMLElement>();
  return {
    id: 'toggle-chat-input-focus',
    name: 'Toggle chat input focus',
    checkCallback: (checking: boolean) => {
      const doc = deps.getActiveDocument();
      if (!doc) return false;
      const inputs = deps.getInputs().filter(input => input.ownerDocument === doc && isVisible(input));
      const input = inputs.find(candidate => candidate.contains(doc.activeElement))
        ?? inputs.find(candidate => candidate === deps.getPreferredInput())
        ?? inputs[0];
      if (!input) return false;
      if (checking) return true;

      if (input.contains(doc.activeElement)) {
        const previous = previousFocus.get(input);
        if (previous && isVisible(previous)) previous.focus({ preventScroll: true });
      } else {
        const previous = doc.activeElement as HTMLElement | null;
        if (previous && typeof previous.focus === 'function' && previous !== doc.body) {
          previousFocus.set(input, previous);
        } else {
          previousFocus.delete(input);
        }
        input.focus({ preventScroll: true });
      }
      return true;
    },
  };
}
