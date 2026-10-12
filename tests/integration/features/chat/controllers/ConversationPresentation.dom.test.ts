/** @jest-environment jsdom */

import { ConversationController, type ConversationControllerDeps } from '@/features/chat/controllers/ConversationController';
import { OPEN_SUBAGENT_TRANSCRIPT_EVENT } from '@/features/chat/OpenSubagentTranscriptEvent';

it('moves transcript event handling to the current surface and fences an old release handle', () => {
  const first = document.createElement('div');
  const replacement = document.createElement('div');
  let current: HTMLElement | null = first;
  const controller = new ConversationController({ getMessagesEl: () => current } as ConversationControllerDeps);
  const open = jest.spyOn(controller, 'openSubagentTranscript').mockResolvedValue(undefined);
  const release = controller.attachPresentation();
  current = replacement;
  controller.attachPresentation();
  release();
  first.dispatchEvent(new CustomEvent(OPEN_SUBAGENT_TRANSCRIPT_EVENT, { detail: { taskToolId: 'old-task' } }));
  replacement.dispatchEvent(new CustomEvent(OPEN_SUBAGENT_TRANSCRIPT_EVENT, { detail: { taskToolId: 'current-task' } }));
  expect(open.mock.calls).toEqual([[{ taskToolId: 'current-task' }]]);
  controller.detachPresentation();
  current = null;
  replacement.dispatchEvent(new CustomEvent(OPEN_SUBAGENT_TRANSCRIPT_EVENT, { detail: { taskToolId: 'released-task' } }));
  expect(open).toHaveBeenCalledTimes(1);
});
