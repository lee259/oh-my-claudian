/** @jest-environment jsdom */

import { RuntimeComposer } from '@/features/chat/sessions/RuntimeComposer';

it('keeps unsent composer text when its input detaches and ignores cleanup from the old pane', () => {
  const composer = new RuntimeComposer();
  const previous = document.createElement('textarea');
  const detach = composer.attach(previous);
  previous.value = 'Unsent draft';
  previous.dispatchEvent(new Event('input'));
  detach();
  const current = document.createElement('textarea');
  composer.attach(current);
  detach();
  expect(current.value).toBe('Unsent draft');
  composer.value = 'Continue the plan.';
  expect(current.value).toBe('Continue the plan.');
  expect(previous.value).toBe('Unsent draft');
});
