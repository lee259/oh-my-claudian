import { createMockEl } from '@test/helpers/MockElement';

import { getOrCreateMessageActionRow } from '@/features/chat/rendering/MessageActionRow';

describe('getOrCreateMessageActionRow', () => {
  it('creates one direct child action row with the shared message-action classes', () => {
    const messageEl = createMockEl();

    const row = getOrCreateMessageActionRow(messageEl);

    expect(row.hasClass('claudian-message-action-row')).toBe(true);
    expect(row.hasClass('claudian-message-actions')).toBe(true);
    expect(messageEl.children).toContain(row);
  });

  it('reuses the direct child row instead of creating duplicate action areas', () => {
    const messageEl = createMockEl();
    const existing = messageEl.createDiv({ cls: 'claudian-message-action-row claudian-message-actions' });

    expect(getOrCreateMessageActionRow(messageEl)).toBe(existing);
    expect(messageEl.children).toHaveLength(1);
  });
});
