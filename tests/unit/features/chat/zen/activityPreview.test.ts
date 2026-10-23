import { ChatState } from '@/features/chat/state/ChatState';
import { getZenActivityPreview } from '@/features/chat/zen/activityPreview';

it('prefers the final answer over earlier narration and returns bounded Unicode text', () => {
  const state = new ChatState();
  state.addMessage({ id: 'a', role: 'assistant', timestamp: 1, content: 'Earlier narration', contentBlocks: [
    { type: 'text', content: 'Earlier narration' }, { type: 'text', content: '🙂'.repeat(300) },
  ] });
  const preview = getZenActivityPreview(state);
  expect(Array.from(preview.text)).toHaveLength(240);
  expect(preview.text).toBe('🙂'.repeat(239) + '…');
});

it('projects action-required state independently of hidden message DOM', () => {
  const state = new ChatState();
  state.beginActionRequired('approval-1');
  expect(getZenActivityPreview(state)).toMatchObject({ requiresAction: true, working: false });
  state.endActionRequired('approval-1');
  state.isStreaming = true;
  state.response.text = 'Reading a note';
  expect(getZenActivityPreview(state)).toMatchObject({ text: 'Reading a note', requiresAction: false, working: true });
});
