export interface ComposerInputTarget {
  readonly ownerDocument?: Document;
  dispatchEvent?(event: Event): boolean;
}

/** Notifies composer UI observers after code updates a textarea value. */
export function dispatchComposerInputEvent(inputEl: ComposerInputTarget): void {
  if (typeof inputEl.dispatchEvent !== 'function') return;

  const EventConstructor = inputEl.ownerDocument?.defaultView?.Event ?? Event;
  inputEl.dispatchEvent(new EventConstructor('input', { bubbles: true }));
}
