/** @jest-environment jsdom */
import '@test/helpers/ObsidianSettingsDOM';

import { Component } from 'obsidian';

import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';

it('releases file link handlers when the renderer is disposed', () => {
  const openLinkText = jest.fn();
  const plugin = { app: { workspace: { openLinkText } }, settings: { mediaFolder: '' } };
  const component = new Component();
  component.load();
  const container = document.createElement('div');
  const link = document.createElement('a');
  link.className = 'internal-link';
  link.setAttribute('href', 'Example');
  container.append(link);
  const renderer = new MessageRenderer(plugin as never, component, container);

  link.click();
  expect(openLinkText).toHaveBeenCalledTimes(1);
  renderer.dispose();
  link.click();
  expect(openLinkText).toHaveBeenCalledTimes(1);
  const replacement = new MessageRenderer(plugin as never, component, container);
  link.click();
  expect(openLinkText).toHaveBeenCalledTimes(2);
  replacement.dispose();
  component.unload();
});
