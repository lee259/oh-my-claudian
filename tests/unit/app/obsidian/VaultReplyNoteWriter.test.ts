import { type App, TFile } from 'obsidian';

import { VaultReplyNoteWriter } from '@/app/obsidian/VaultReplyNoteWriter';

function createVault() {
  const files = new Map<string, { file: TFile; content: string }>();
  const put = (path: string, content: string) => {
    const file = Object.assign(new TFile(), { path, extension: 'md' });
    files.set(path, { file, content });
    return file;
  };
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path)?.file ?? null,
      create: async (path: string, content: string) => {
        if (files.has(path)) throw new Error('File exists');
        return put(path, content);
      },
      process: async (file: TFile, transform: (current: string) => string) => {
        const record = files.get(file.path);
        if (!record || record.file !== file) throw new Error('File missing');
        record.content = transform(record.content);
        return record.content;
      },
    },
  } as unknown as App;
  return { app, files, put, writer: new VaultReplyNoteWriter(app) };
}

describe('VaultReplyNoteWriter', () => {
  it('creates a Markdown note without changing the answer formatting', async () => {
    const { writer, files } = createVault();
    const receipt = await writer.save({ mode: 'create', path: 'Summary.md', content: '# Summary\n\nSee [[Source]].\n' });
    expect(receipt.path).toBe('Summary.md');
    expect(files.get('Summary.md')?.content).toBe('# Summary\n\nSee [[Source]].\n');
  });

  it('appends to the latest note and undoes only its text, keeping later additions', async () => {
    const { writer, files, put } = createVault();
    put('Existing.md', 'My draft\n');
    const receipt = await writer.save({ mode: 'append', path: 'Existing.md', content: '**Answer**\n' });
    expect(files.get('Existing.md')?.content).toBe('My draft\n\n**Answer**\n');
    files.get('Existing.md')!.content += '\nMy next paragraph.\n';
    await receipt.undo();
    expect(files.get('Existing.md')?.content).toBe('My draft\n\nMy next paragraph.\n');
    await receipt.undo();
    expect(files.get('Existing.md')?.content).toBe('My draft\n\nMy next paragraph.\n');
  });

  it('refuses to undo text that was subsequently edited', async () => {
    const { writer, files, put } = createVault();
    put('Existing.md', 'My draft');
    const receipt = await writer.save({ mode: 'append', path: 'Existing.md', content: 'Answer' });
    files.get('Existing.md')!.content = 'My draft\n\nEdited answer\n';
    await expect(receipt.undo()).rejects.toMatchObject({ code: 'conflict' });
    expect(files.get('Existing.md')?.content).toBe('My draft\n\nEdited answer\n');
  });

  it('keeps a new note and removes only the saved text when undoing', async () => {
    const { writer, files } = createVault();
    const receipt = await writer.save({ mode: 'create', path: 'New.md', content: 'Answer' });
    await receipt.undo();
    expect(files.get('New.md')?.content).toBe('');
  });

  it.each(['../outside.md', '/absolute.md', 'C:/outside.md', '.obsidian/settings.md', 'folder/../note.md', 'image.png', 'folder//note.md'])('rejects an invalid destination: %s', async (path) => {
    const { writer, files } = createVault();
    await expect(writer.save({ mode: 'create', path, content: 'Answer' })).rejects.toMatchObject({ code: 'invalidPath' });
    expect(files.size).toBe(0);
  });

  it('does not replace an existing note or save an empty reply', async () => {
    const { writer, files, put } = createVault();
    put('Existing.md', 'Keep me');
    await expect(writer.save({ mode: 'create', path: 'Existing.md', content: 'Answer' })).rejects.toMatchObject({ code: 'exists' });
    await expect(writer.save({ mode: 'append', path: 'Existing.md', content: '  \n' })).rejects.toMatchObject({ code: 'emptyContent' });
    expect(files.get('Existing.md')?.content).toBe('Keep me');
  });

  it('does not undo into a file recreated at the same path', async () => {
    const { writer, files, put } = createVault();
    const receipt = await writer.save({ mode: 'create', path: 'New.md', content: 'Answer' });
    put('New.md', 'Answer');
    await expect(receipt.undo()).rejects.toMatchObject({ code: 'missingNote' });
    expect(files.get('New.md')?.content).toBe('Answer');
  });

  it('coalesces concurrent undo requests for the same saved text', async () => {
    const { writer, files } = createVault();
    const receipt = await writer.save({ mode: 'create', path: 'New.md', content: 'Answer' });
    await Promise.all([receipt.undo(), receipt.undo()]);
    expect(files.get('New.md')?.content).toBe('');
  });
});
