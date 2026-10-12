/** @jest-environment jsdom */

import { RuntimeMessagePresentation } from '@/features/chat/sessions/RuntimeMessagePresentation';

it('drops presentation calls while detached and directs later calls only to the current renderer', async () => {
  const presentation = new RuntimeMessagePresentation();
  const previous = { renderContent: jest.fn(async () => undefined) };
  const current = { renderContent: jest.fn(async () => undefined) };
  const el = document.createElement('div');
  const detach = presentation.attach(previous as any);
  await presentation.renderContent(el, 'before');
  detach();
  await presentation.renderContent(el, 'headless');
  presentation.attach(current as any);
  detach();
  await presentation.renderContent(el, 'after');
  expect(previous.renderContent.mock.calls).toEqual([[el, 'before']]);
  expect(current.renderContent.mock.calls).toEqual([[el, 'after']]);
});
