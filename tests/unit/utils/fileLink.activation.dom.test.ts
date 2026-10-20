/** @jest-environment jsdom */

import { fireEvent, waitFor } from '@testing-library/dom';
import { type App, type Component,Notice } from 'obsidian';

import { registerFileLinkHandler } from '@/utils/fileLink';

beforeEach(() => jest.mocked(Notice).mockClear());
afterEach(() => document.body.replaceChildren());

it.each(['file', 'folder'] as const)('reports a failed %s activation once and allows retry without leaking error details', async kind => {
  const activate = jest.fn().mockRejectedValueOnce(new Error('PRIVATE_PATH_AND_TOKEN'))
    .mockResolvedValue(undefined);
  const folder = { path: 'Projects' };
  const app = { vault: { getAbstractFileByPath: () => folder }, workspace: {
    openLinkText: activate, getLeavesOfType: () => [{ view: { revealInFolder: activate } }],
  } } as unknown as App;
  const container = document.body.createDiv();
  const anchor = container.createEl('a', { cls: 'claudian-file-link', text: 'Target',
    attr: { href: kind === 'file' ? 'Note#Heading' : 'Projects',
      ...(kind === 'folder' ? { 'data-claudian-folder-link': 'true' } : {}) } });
  const component = { registerDomEvent: (el: HTMLElement, type: string, listener: EventListener) => el.addEventListener(type, listener) } as unknown as Component;
  registerFileLinkHandler(app, container, component);
  expect(fireEvent.click(anchor)).toBe(false);
  await waitFor(() => expect(Notice).toHaveBeenCalledTimes(1));
  const message = jest.mocked(Notice).mock.calls[0][0];
  expect(message).toBe(kind === 'file' ? 'Could not open file.' : 'Could not reveal file or folder.');
  expect(message).not.toContain('PRIVATE');
  fireEvent.click(anchor);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(activate).toHaveBeenCalledTimes(2);
  expect(Notice).toHaveBeenCalledTimes(1);
  expect(activate).toHaveBeenLastCalledWith(...(kind === 'file' ? ['Note#Heading', '', 'tab'] : [folder]));
});
