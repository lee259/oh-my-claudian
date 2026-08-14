import { createMockEl } from '@test/helpers/MockElement';

import {
  buildScopePreviewModel,
  ScopePreview,
} from '@/features/chat/ui/ScopePreview';

jest.mock('obsidian', () => ({
  setIcon: jest.fn(),
}));

describe('ScopePreview', () => {
  it('does not present a scope when no context is selected', () => {
    expect(buildScopePreviewModel(null, [])).toBeNull();
  });

  it('summarizes the active note and selected folders', () => {
    expect(buildScopePreviewModel('notes/Plan.md', ['docs', 'src/'])).toEqual({
      label: 'Context scope',
      detail: 'note: Plan.md · folders: docs, src',
      title: expect.stringContaining('Writes remain governed'),
    });
  });

  it('renders and clears the non-interactive preview', () => {
    const containerEl = createMockEl();
    const preview = new ScopePreview(containerEl as unknown as HTMLElement);

    expect(containerEl.hasClass('has-content')).toBe(false);
    preview.setCurrentNote('notes/Plan.md');
    expect(containerEl.hasClass('has-content')).toBe(true);
    expect(containerEl.querySelector('.claudian-scope-preview-label')?.textContent).toBe('Context scope:');
    expect(containerEl.querySelector('.claudian-scope-preview-detail')?.textContent).toBe('note: Plan.md');

    preview.clear();
    expect(containerEl.hasClass('has-content')).toBe(false);
    expect(containerEl.children).toHaveLength(0);
  });
});
