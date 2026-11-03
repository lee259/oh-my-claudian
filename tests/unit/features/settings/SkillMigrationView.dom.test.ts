/** @jest-environment jsdom */
import { fireEvent, getByRole, waitFor } from '@testing-library/dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SkillMigrationView } from '@/shared/settings/SkillMigrationView';

const mockNotices: string[] = [];
jest.mock('obsidian', () => ({
  Notice: class {
    constructor(message: string) {
      mockNotices.push(message);
    }
  },
}));

afterEach(() => {
  mockNotices.length = 0;
});

it('requires a preview and explicit confirmation before copying', async () => {
  const candidate = { name: 'review', source: '.claude/skills/review/SKILL.md', revision: '1', warnings: [], blocked: false, extraFiles: [], markdown: 'reviewed content' };
  const service = { preview: jest.fn(async () => [candidate]), prepare: jest.fn(async () => ({ name: 'review', markdown: 'content', files: [], directories: [] })) };
  const copy = jest.fn(async () => {});
  const container = document.createElement('div');
  await act(() => { render(h(SkillMigrationView, { getService: async () => service, onCopy: copy }), container); });
  await act(async () => { fireEvent.click(getByRole(container, 'button', { name: 'Preview import' })); });
  await waitFor(() => expect(getByRole(container, 'button', { name: 'Copy to shared skills' })).toBeTruthy());
  expect(container.textContent).toContain('reviewed content');
  await act(() => { fireEvent.click(getByRole(container, 'button', { name: 'Copy to shared skills' })); });
  expect(copy).not.toHaveBeenCalled();
  fireEvent.click(getByRole(container, 'button', { name: 'Confirm' }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith('review', 'content', [], [], undefined));
  render(null, container);
});

it('shows the preview failure reason', async () => {
  const service = {
    preview: jest.fn(async () => { throw new Error('Claude directory is unreadable'); }),
    prepare: jest.fn(),
  };
  const container = document.createElement('div');
  await act(() => {
    render(h(SkillMigrationView, { getService: async () => service, onCopy: jest.fn() }), container);
  });
  await act(async () => {
    fireEvent.click(getByRole(container, 'button', { name: 'Preview import' }));
  });

  await waitFor(() => expect(mockNotices).toContain('Import failed: Claude directory is unreadable'));
  render(null, container);
});

it('groups blocked entries without exposing a copy action', async () => {
  const service = {
    preview: jest.fn(async () => [{
      name: 'broken',
      source: '.claude/skills/broken',
      revision: '1',
      warnings: ['brokenSymlink'],
      blocked: true,
      extraFiles: [],
      linkTarget: '.agents/skills/broken',
    }]),
    prepare: jest.fn(),
  };
  const container = document.createElement('div');
  await act(() => {
    render(h(SkillMigrationView, { getService: async () => service, onCopy: jest.fn() }), container);
  });
  await act(async () => {
    fireEvent.click(getByRole(container, 'button', { name: 'Preview import' }));
  });

  await waitFor(() => expect(container.textContent).toContain('1 entries need attention'));
  expect(container.textContent).toContain('This Claude entry is a broken link.');
  expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Copy to shared skills'))
    .toBe(false);
  render(null, container);
});
