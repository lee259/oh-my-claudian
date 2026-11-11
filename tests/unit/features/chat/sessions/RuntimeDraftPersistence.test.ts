import { RuntimeComposer } from '@/features/chat/sessions/RuntimeComposer';
import { RuntimeDraftPersistence } from '@/features/chat/sessions/RuntimeDraftPersistence';

it('restores the draft and clears it after the composer is emptied', async () => {
  const drafts = new Map([['conversation:one', 'unfinished @note.md']]);
  const storage = {
    read: jest.fn(async (scope: string, id: string) => drafts.get(`${scope}:${id}`) ?? ''),
    write: jest.fn(async (scope: string, id: string, text: string) => { drafts.set(`${scope}:${id}`, text); }),
  };
  const composer = new RuntimeComposer();
  const owner = new RuntimeDraftPersistence(composer, storage as never, { scope: 'conversation', id: 'one' });
  await owner.initialize();
  expect(composer.value).toBe('unfinished @note.md');
  composer.value = '';
  await owner.flush();
  expect(drafts.get('conversation:one')).toBe('');
  await owner.dispose();
});

it('does not overwrite text entered while a stored draft is loading', async () => {
  let resolve!: (value: string) => void;
  const storage = { read: jest.fn(() => new Promise<string>(r => { resolve = r; })), write: jest.fn(async () => undefined) };
  const composer = new RuntimeComposer();
  const owner = new RuntimeDraftPersistence(composer, storage as never, { scope: 'tab', id: 'one' });
  const loading = owner.initialize();
  composer.value = 'new input';
  resolve('old draft');
  await loading;
  expect(composer.value).toBe('new input');
  await owner.flush();
  expect(storage.write).toHaveBeenLastCalledWith('tab', 'one', 'new input');
  await owner.dispose();
});

it('moves a blank tab draft to its new conversation without overwriting another draft', async () => {
  const drafts = new Map([['conversation:other', 'untouched']]);
  const storage = {
    read: jest.fn(async (scope: string, id: string) => drafts.get(`${scope}:${id}`) ?? ''),
    write: jest.fn(async (scope: string, id: string, text: string) => { drafts.set(`${scope}:${id}`, text); }),
  };
  const composer = new RuntimeComposer();
  const owner = new RuntimeDraftPersistence(composer, storage as never, { scope: 'tab', id: 'blank' });
  await owner.initialize();
  composer.value = 'unfinished';
  await owner.flush();
  owner.rebind({ scope: 'conversation', id: 'new' });
  await owner.flush();
  expect(drafts.get('conversation:new')).toBe('unfinished');
  expect(drafts.get('tab:blank')).toBe('');
  expect(drafts.get('conversation:other')).toBe('untouched');
  await owner.dispose();
});

it('retries a failed save during a later flush', async () => {
  const storage = { read: jest.fn(async () => ''), write: jest.fn().mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined) };
  const composer = new RuntimeComposer();
  const owner = new RuntimeDraftPersistence(composer, storage as never, { scope: 'conversation', id: 'one' });
  await owner.initialize();
  composer.value = 'unsent';
  await expect(owner.flush()).rejects.toThrow('disk');
  await owner.flush();
  expect(storage.write).toHaveBeenCalledTimes(2);
  await owner.dispose();
});

it('retries moving a draft after the destination write fails', async () => {
  const drafts = new Map<string, string>();
  let fail = true;
  const storage = {
    read: jest.fn(async (scope: string, id: string) => drafts.get(`${scope}:${id}`) ?? ''),
    write: jest.fn(async (scope: string, id: string, text: string) => {
      if (scope === 'conversation' && fail) { fail = false; throw new Error('disk'); }
      drafts.set(`${scope}:${id}`, text);
    }),
  };
  const composer = new RuntimeComposer();
  const owner = new RuntimeDraftPersistence(composer, storage as never, { scope: 'tab', id: 'blank' });
  await owner.initialize();
  composer.value = 'keep this';
  await owner.flush();
  owner.rebind({ scope: 'conversation', id: 'new' });
  await expect(owner.flush()).rejects.toThrow('disk');
  await owner.flush();
  expect(drafts.get('conversation:new')).toBe('keep this');
  expect(drafts.get('tab:blank')).toBe('');
  await owner.dispose();
});

it('removes the original draft when an in-flight move fails during discard', async () => {
  const drafts = new Map<string, string>();
  let rejectMove!: (error: Error) => void;
  let moveStarted!: () => void;
  const started = new Promise<void>(resolve => { moveStarted = resolve; });
  const storage = {
    read: jest.fn(async () => ''),
    write: jest.fn(async (scope: string, id: string, text: string) => {
      if (scope === 'conversation' && text) {
        moveStarted();
        await new Promise<void>((_, reject) => { rejectMove = reject; });
      }
      drafts.set(`${scope}:${id}`, text);
    }),
  };
  const composer = new RuntimeComposer();
  const owner = new RuntimeDraftPersistence(composer, storage as never, { scope: 'tab', id: 'blank' });
  await owner.initialize();
  composer.value = 'unsent';
  await owner.flush();
  owner.rebind({ scope: 'conversation', id: 'new' });
  const moving = owner.flush();
  await started;
  const discarding = owner.discard();
  rejectMove(new Error('disk'));
  await expect(moving).rejects.toThrow('disk');
  await discarding;
  expect(drafts.get('tab:blank')).toBe('');
  expect(drafts.get('conversation:new')).toBe('');
});
