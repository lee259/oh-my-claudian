/** Schedules a guarded composer-driven scroll after render updates. */
export function syncComposerAutoScroll(
  isEnabled: () => boolean,
  isAutoScrollActive: () => boolean,
  getMessagesEl: () => HTMLElement,
): void {
  if (!isEnabled() || !isAutoScrollActive()) return;
  window.requestAnimationFrame(() => {
    if (!isEnabled() || !isAutoScrollActive()) return;
    const messagesEl = getMessagesEl();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}
