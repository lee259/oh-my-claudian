/** @jest-environment jsdom */
import { fireEvent, getByRole, waitFor } from '@testing-library/dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SkillMigrationView } from '@/shared/settings/SkillMigrationView';

jest.mock('obsidian', () => ({
  Notice: class {},
}));

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
