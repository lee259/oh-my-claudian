import { parseAgentSkillMarkdown } from '@/core/skills/AgentSkillCodec';
import { ClaudeSkillMigration } from '@/providers/claude/skills/ClaudeSkillMigration';

it('previews the source and rejects changed files before copying', async () => {
  const raw = '---\nname: review\ndescription: Review changes\n---\nReview carefully.';
  const files = {
    getManagedMode: jest.fn(async () => undefined),
    exists: jest.fn(async () => false),
    verifyManagedPath: jest.fn(async (p: string) => p === '.claude/skills' || p === '.claude/skills/review'),
    listManagedFolder: jest.fn(async (p: string) => p === '.claude/skills'
      ? { folders: ['.claude/skills/review'], files: [] }
      : { folders: [], files: ['.claude/skills/review/SKILL.md'] }),
    readManagedFile: jest.fn(async () => raw),
  };
  const migration = new ClaudeSkillMigration(files as never);
  const [candidate] = await migration.preview();
  expect(candidate).toMatchObject({ name: 'review', blocked: false, extraFiles: [] });
  files.readManagedFile.mockResolvedValueOnce(raw + ' changed');
  await expect(migration.prepare(candidate)).rejects.toThrow();
});

it('blocks existing destinations and packages with extra files', async () => {
  const files = {
    getManagedMode: jest.fn(async () => undefined),
    exists: jest.fn(async () => true),
    verifyManagedPath: jest.fn(async (p: string) => p === '.claude/skills'),
    listManagedFolder: jest.fn(async (p: string) => p === '.claude/skills'
      ? { folders: ['.claude/skills/review'], files: [] }
      : { folders: ['.claude/skills/review/scripts'], files: ['.claude/skills/review/SKILL.md'] }),
    readManagedFile: jest.fn(async () => '---\nname: review\ndescription: Review\n---\nReview.'),
  };
  const migration = new ClaudeSkillMigration(files as never);
  const [candidate] = await migration.preview();
  expect(candidate.blocked).toBe(true);
  expect(candidate.warnings).toEqual(expect.arrayContaining(['conflict', 'extraFiles']));
  expect(candidate.extraFiles).toContain('.claude/skills/review/scripts');
  await expect(migration.prepare(candidate)).rejects.toThrow();
});

it('copies an unchanged reviewed skill and retains the source content', async () => {
  const raw = '---\nname: review\ndescription: Review changes\nmodel: sonnet\n---\nReview carefully.';
  const files = {
    getManagedMode: jest.fn(async () => undefined),
    exists: jest.fn(async () => false),
    verifyManagedPath: jest.fn(async (p: string) => p === '.claude/skills'),
    listManagedFolder: jest.fn(async (p: string) => p === '.claude/skills'
      ? { folders: ['.claude/skills/review'], files: [] }
      : { folders: [], files: ['.claude/skills/review/SKILL.md'] }),
    readManagedFile: jest.fn(async () => raw),
  };
  const migration = new ClaudeSkillMigration(files as never);
  const [candidate] = await migration.preview();
  expect(candidate.warnings).toContain('frontmatter');
  await expect(migration.prepare(candidate)).resolves.toEqual({ name: 'review', markdown: raw, files: [], directories: [], rootMode: undefined });
});

it('converts a command while retaining provider-specific frontmatter and warning about syntax', async () => {
  const raw = '---\ndescription: Review changes\nmodel: sonnet\n---\nReview $ARGUMENTS.';
  const files = {
    getManagedMode: jest.fn(async () => undefined),
    exists: jest.fn(async () => false),
    verifyManagedPath: jest.fn(async (p: string) => p === '.claude/commands'),
    listManagedFolder: jest.fn(async () => ({ folders: [], files: ['.claude/commands/review.md'] })),
    readManagedFile: jest.fn(async () => raw),
  };
  const migration = new ClaudeSkillMigration(files as never);
  const [candidate] = await migration.preview();
  expect(candidate.blocked).toBe(false);
  expect(candidate.warnings).toEqual(expect.arrayContaining(['frontmatter', 'syntax']));
  const prepared = await migration.prepare(candidate);
  expect(prepared.markdown).toContain('model:');
  expect(prepared.markdown).toContain('Review $ARGUMENTS.');
});

it('adds the directory name when a Claude skill omits the optional name field', async () => {
  const raw = '---\ndescription: Review changes\nmodel: sonnet\n---\nReview carefully.';
  const files = {
    getManagedMode: jest.fn(async () => undefined),
    exists: jest.fn(async () => false),
    verifyManagedPath: jest.fn(async (p: string) => p === '.claude/skills'),
    listManagedFolder: jest.fn(async (p: string) => p === '.claude/skills'
      ? { folders: ['.claude/skills/review'], files: [] }
      : { folders: [], files: ['.claude/skills/review/SKILL.md'] }),
    readManagedFile: jest.fn(async () => raw),
  };
  const migration = new ClaudeSkillMigration(files as never);
  const [candidate] = await migration.preview();
  expect(candidate.blocked).toBe(false);
  const prepared = await migration.prepare(candidate);
  expect(parseAgentSkillMarkdown(prepared.markdown, 'review').name).toBe('review');
  expect(prepared.markdown).toContain('model:');
});

it('previews and copies supporting files while detecting changed content', async () => {
  const raw = '---\nname: review\ndescription: Review changes\n---\nReview carefully.';
  const files = {
    exists: jest.fn(async () => false),
    verifyManagedPath: jest.fn(async (p: string) => p === '.claude/skills'),
    listManagedFolder: jest.fn(async (p: string) => p === '.claude/skills'
      ? { folders: ['.claude/skills/review'], files: [] }
      : p.endsWith('/review') ? { folders: ['.claude/skills/review/scripts'], files: ['.claude/skills/review/SKILL.md'] }
        : { folders: [], files: ['.claude/skills/review/scripts/check.sh'] }),
    readManagedFile: jest.fn(async () => raw),
    readManagedBinaryFile: jest.fn(async () => new Uint8Array([1, 2]).buffer),
    getManagedFileMode: jest.fn(async () => 0o755),
    getManagedMode: jest.fn(async () => 0o700),
  };
  const migration = new ClaudeSkillMigration(files as never);
  const [candidate] = await migration.preview();
  expect(candidate.blocked).toBe(false);
  expect(candidate.extraFiles).toContain('.claude/skills/review/scripts/check.sh');
  const result = await migration.prepare(candidate);
  expect(result.files[0].path).toBe('scripts/check.sh');
  expect(result.files[0].mode).toBe(0o755);
  expect(result.directories).toEqual([{ path: 'scripts', mode: 0o700 }]);
  files.readManagedBinaryFile.mockResolvedValue(new Uint8Array([3]).buffer);
  await expect(migration.prepare(candidate)).rejects.toThrow();
});

it('blocks supporting filenames that cannot be copied on Windows', async () => {
  const files = {
    getManagedMode: jest.fn(async () => undefined),
    exists: jest.fn(async () => false), verifyManagedPath: jest.fn(async (p: string) => p === '.claude/skills'),
    listManagedFolder: jest.fn(async (p: string) => p === '.claude/skills'
      ? { folders: ['.claude/skills/review'], files: [] }
      : { folders: [], files: ['.claude/skills/review/SKILL.md', '.claude/skills/review/CON.txt'] }),
    readManagedFile: jest.fn(async () => '---\nname: review\ndescription: Review\n---\nReview.'),
    readManagedBinaryFile: jest.fn(async () => new Uint8Array([1]).buffer),
    getManagedFileMode: jest.fn(async () => undefined),
  };
  const [candidate] = await new ClaudeSkillMigration(files as never).preview();
  expect(candidate.blocked).toBe(true);
  expect(candidate.nonPortablePaths).toContain('CON.txt');
});

it('previews an inferred description when a native command has none', async () => {
  const files = {
    getManagedMode: jest.fn(async () => undefined), exists: jest.fn(async () => false),
    verifyManagedPath: jest.fn(async (p: string) => p === '.claude/commands'),
    listManagedFolder: jest.fn(async () => ({ folders: [], files: ['.claude/commands/review.md'] })),
    readManagedFile: jest.fn(async () => 'Review the current change.\n\nUse a checklist.'),
  };
  const migration = new ClaudeSkillMigration(files as never);
  const [candidate] = await migration.preview();
  expect(candidate.blocked).toBe(false);
  expect(candidate.description).toBe('Review the current change.');
  expect(candidate.warnings).toContain('generatedDescription');
});

it('blocks a command with unterminated frontmatter', async () => {
  const files = {
    exists: jest.fn(async () => false), verifyManagedPath: jest.fn(async (p: string) => p === '.claude/commands'),
    listManagedFolder: jest.fn(async () => ({ folders: [], files: ['.claude/commands/broken.md'] })),
    readManagedFile: jest.fn(async () => '---\ndescription: incomplete\nbody'),
  };
  const [candidate] = await new ClaudeSkillMigration(files as never).preview();
  expect(candidate.blocked).toBe(true);
  expect(candidate.warnings).toContain('invalid');
});

it('preserves a nested command path in a portable skill name and exposes duplicate targets', async () => {
  const files = {
    exists: jest.fn(async () => false),
    verifyManagedPath: jest.fn(async (p: string) => p === '.claude/commands'),
    listManagedFolder: jest.fn(async (p: string) => p === '.claude/commands'
      ? { folders: ['.claude/commands/Review'], files: ['.claude/commands/review-deep.md'] }
      : { folders: [], files: ['.claude/commands/Review/Deep.md'] }),
    readManagedFile: jest.fn(async () => 'Review this change.'),
  };
  const candidates = await new ClaudeSkillMigration(files as never).preview();
  expect(candidates.map(candidate => candidate.name)).toEqual(['review-deep', 'review-deep']);
  expect(candidates.every(candidate => candidate.blocked)).toBe(true);
  expect(candidates.every(candidate => candidate.warnings.includes('duplicateName'))).toBe(true);
  expect(candidates[0].renamedFrom ?? candidates[1].renamedFrom).toBe('Review/Deep');
});
