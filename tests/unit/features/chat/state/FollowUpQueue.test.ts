import { FollowUpQueue } from '@/features/chat/state/FollowUpQueue';

describe('FollowUpQueue', () => {
  it('pauses without discarding input and resumes in the chosen order', () => {
    const queue = new FollowUpQueue();
    for (const id of ['fix', 'test', 'review']) {
      queue.enqueue(id, { content: id, editorContext: null, canvasContext: null });
    }
    queue.pause();
    expect(queue.takeNext()).toBeNull();
    expect(queue.move('review', -1)).toBe(true);
    expect(queue.items.map(item => item.id)).toEqual(['fix', 'review', 'test']);
    queue.resume();
    expect(queue.takeNext()?.id).toBe('fix');
    expect(queue.move('fix', 1)).toBe(false);
  });

  it('withdraws to a retained composer context while the remaining queue can continue', () => {
    const queue = new FollowUpQueue();
    const onDelivery = jest.fn();
    queue.enqueue('fix', { content: 'Fix', editorContext: null, canvasContext: null, onDelivery,
      turnRequest: { text: 'Fix', contextFiles: ['first.md'] } });
    queue.enqueue('test', { content: 'Test', editorContext: null, canvasContext: null });
    const editing = queue.withdrawForEditing('fix');
    expect(editing?.turnRequest?.contextFiles).toEqual(['first.md']);
    expect(queue.items.map(item => item.id)).toEqual(['test']);
    expect(queue.takeNext()?.id).toBe('test');
    expect(onDelivery).not.toHaveBeenCalled();
    queue.finishEditing(editing);
    expect(queue.editingMessage).toBeNull();
  });

  it('reorders only waiting input around hidden delivery records', () => {
    const queue = new FollowUpQueue();
    for (const id of ['first', 'pending', 'third', 'fourth']) queue.enqueue(id, { content: id, editorContext: null, canvasContext: null });
    queue.setStatus('pending', 'sending');
    expect(queue.moveTo('pending', 'fourth')).toBe(false);
    expect(queue.moveTo('fourth', 'first')).toBe(true);
    expect(queue.items.map(item => item.id)).toEqual(['fourth', 'pending', 'first', 'third']);
    expect(queue.moveTo('fourth', 'third', true)).toBe(true);
    expect(queue.items.map(item => item.id)).toEqual(['first', 'pending', 'third', 'fourth']);
  });
  it('keeps separate ordered instructions and their context snapshots', () => {
    const queue = new FollowUpQueue();
    const files = ['first.md'];
    queue.enqueue('first', { content: 'Fix', editorContext: null, canvasContext: null,
      turnRequest: { text: 'Fix', contextFiles: files } });
    queue.enqueue('second', { content: 'Test', editorContext: null, canvasContext: null,
      turnRequest: { text: 'Test', contextFiles: ['second.md'] } });
    files.push('later.md');
    expect(queue.items.map(item => item.message.content)).toEqual(['Fix', 'Test']);
    expect(queue.items[0].message.turnRequest?.contextFiles).toEqual(['first.md']);
    expect(queue.takeNext()?.id).toBe('first');
    expect(queue.takeNext()).toBeNull();
    queue.remove('first');
    expect(queue.takeNext()?.message.content).toBe('Test');
  });

  it('retains the original canvas and editor selections after later UI changes', () => {
    const queue = new FollowUpQueue();
    const selection = { mode: 'selection' as const, notePath: 'first.md', selectedText: 'Original' };
    const canvas = { canvasPath: 'first.canvas', nodeIds: ['first-node'] };
    queue.enqueue('first', { content: 'Fix', editorContext: selection, canvasContext: canvas,
      turnRequest: { text: 'Fix', editorSelection: selection, canvasSelection: canvas } });
    selection.selectedText = 'Later';
    canvas.nodeIds.push('later-node');
    expect(queue.items[0].message.turnRequest?.editorSelection?.selectedText).toBe('Original');
    expect(queue.items[0].message.turnRequest?.canvasSelection?.nodeIds).toEqual(['first-node']);
  });
});
