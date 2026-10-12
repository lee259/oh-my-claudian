/** Schedules a guarded composer-driven scroll after render updates. */
export function syncComposerAutoScroll(
  isEnabled: () => boolean,
  isAutoScrollActive: () => boolean,
  getMessagesEl: () => HTMLElement | null,
): void {
  if (!isEnabled() || !isAutoScrollActive() || !getMessagesEl()) return;
  window.requestAnimationFrame(() => {
    if (!isEnabled() || !isAutoScrollActive()) return;
    const messagesEl = getMessagesEl();
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}
