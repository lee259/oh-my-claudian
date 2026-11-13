/** @jest-environment jsdom */
import { h } from 'preact';

import { HistorySearchView } from '@/features/chat/ui/HistorySearchView';
import { createPreactRoot } from '@/shared/ui/PreactRoot';

jest.mock('obsidian', () => ({ setIcon: jest.fn() }));

it('returns keyboard focus to the search opener when its focused input closes', () => {
  const opener = document.createElement('button');
  const host = document.createElement('div');
  document.body.append(opener, host);
  opener.focus();
  const root = createPreactRoot(host);
  root.render(h(HistorySearchView, { initialQuery: '', onQueryChange: jest.fn(), focusReturnEl: opener }));
  host.querySelector<HTMLInputElement>('input')!.focus();

  root.unmount();

  expect(document.activeElement).toBe(opener);
  opener.remove();
  host.remove();
});

it('does not steal focus when it has already moved elsewhere', () => {
  const opener = document.createElement('button');
  const next = document.createElement('button');
  const host = document.createElement('div');
  document.body.append(opener, next, host);
  const root = createPreactRoot(host);
  root.render(h(HistorySearchView, { initialQuery: '', onQueryChange: jest.fn(), focusReturnEl: opener }));
  host.querySelector<HTMLInputElement>('input')!.focus();
  next.focus();

  root.unmount();

  expect(document.activeElement).toBe(next);
  opener.remove();
  next.remove();
  host.remove();
});
