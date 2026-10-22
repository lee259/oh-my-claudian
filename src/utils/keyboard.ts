/**
 * Structural browser-compatibility boundary: older IME implementations can
 * report 229 before isComposing becomes true. Keep that fallback here rather
 * than forwarding deprecated numeric key codes through synthetic events.
 */
export function isImeKeyEvent(event: {
  readonly isComposing?: boolean;
  readonly key?: string;
  readonly keyCode?: number;
}): boolean {
  return event.isComposing === true || event.key === 'Process' || event.keyCode === 229;
}
