import { EditorSelectionEvents } from '@/features/chat/controllers/EditorSelectionEvents';

describe('EditorSelectionEvents', () => {
  it('notifies subscribers only for selection or document changes and releases them', async () => {
    const events = new EditorSelectionEvents();
    const listener = jest.fn();
    const unsubscribe = events.subscribe(listener);
    const view = {} as any;

    events.notify({ view, selectionSet: false, docChanged: false } as any);
    events.notify({ view, selectionSet: true, docChanged: false } as any);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(view);

    unsubscribe();
    events.notify({ view, selectionSet: false, docChanged: true } as any);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
