/** @jest-environment jsdom */
import '@test/helpers/ObsidianSettingsDOM';

import { ComposerContextTray } from '@/features/chat/ui/ComposerContextTray';

jest.mock('obsidian', () => ({ setIcon: jest.fn() }));

it('keeps an existing focused chip when another context slot changes', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const tray = new ComposerContextTray(host);
  const onActivate = jest.fn();
  tray.setItems('files', [{ id: 'notes/file.md', kind: 'file', label: 'file.md', onActivate }]);
  const chip = host.querySelector<HTMLElement>('.claudian-context-chip-main')!;
  chip.focus();
  tray.setItems('editor-selection', [{ id: 'selection', kind: 'selection', label: '3 lines' }]);
  expect(host.querySelector('.claudian-context-chip-main')).toBe(chip);
  expect(document.activeElement).toBe(chip);
  chip.click();
  expect(onActivate).toHaveBeenCalledTimes(1);
  tray.destroy();
  host.remove();
});
