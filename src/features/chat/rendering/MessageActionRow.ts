const MESSAGE_ACTION_ROW_CLASS = 'claudian-message-action-row';
const MESSAGE_ACTION_VISIBILITY_CLASS = 'claudian-message-actions';

/**
 * Returns the single action row owned by a message shell.
 *
 * Keeping the row as a direct child prevents action controls from becoming
 * part of the content bubble's sizing or Markdown layout.
 */
export function getOrCreateMessageActionRow(messageEl: HTMLElement): HTMLElement {
  const existing = Array.from(messageEl.children).find((child) => (
    child.classList.contains(MESSAGE_ACTION_ROW_CLASS)
  ));
  if (existing) return existing as HTMLElement;

  return messageEl.createDiv({
    cls: `${MESSAGE_ACTION_ROW_CLASS} ${MESSAGE_ACTION_VISIBILITY_CLASS}`,
  });
}
