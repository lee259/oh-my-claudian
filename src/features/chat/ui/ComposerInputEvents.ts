/** Notifies composer UI observers after code updates a textarea value. */
export function dispatchComposerInputEvent(inputEl: HTMLTextAreaElement): void {
  if (typeof inputEl.dispatchEvent !== 'function') return;

  const EventConstructor = inputEl.ownerDocument?.defaultView?.Event ?? Event;
  inputEl.dispatchEvent(new EventConstructor('input', { bubbles: true }));
}
