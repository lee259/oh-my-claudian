import {
  presentCodexCommand,
  presentCodexFileChange,
} from '@/providers/codex/normalization/CodexToolPresentation';

describe('presentCodexCommand', () => {
  it('uses Codex command action metadata and shortens workspace paths', () => {
    expect(presentCodexCommand({
      command: 'cat src/main.ts',
      cwd: '/workspace',
      commandActions: [{ type: 'read', path: '/workspace/src/main.ts' }],
    })).toEqual({ name: 'Read', summary: 'src/main.ts' });
  });

  it.each([
    ['cat src/main.ts', { name: 'Read', summary: 'src/main.ts' }],
    ['rg -n Codex src/providers', { name: 'Find', summary: 'Codex · src/providers' }],
    ['rg --files -g AGENTS.md', { name: 'Find', summary: 'files' }],
    ['ls src/providers', { name: 'List', summary: 'src/providers' }],
    ["sed -i '' 's/a/b/' src/main.ts", { name: 'Edit', summary: 'src/main.ts' }],
  ])('infers a clear intent from %s', (command, expected) => {
    expect(presentCodexCommand({ command, cwd: '/workspace' })).toEqual(expected);
  });

  it('classifies the useful stage of a wrapped pipeline after shell setup commands', () => {
    expect(presentCodexCommand({
      command: `/bin/zsh -lc "cd /workspace && ls && echo '---' && sed -n '1,140p' src/main.ts"`,
      cwd: '/workspace',
    })).toEqual({ name: 'Read', summary: 'src/main.ts' });

    expect(presentCodexCommand({
      command: "rg --files | sed -n '1,240p'",
      cwd: '/workspace',
    })).toEqual({ name: 'Find', summary: 'files' });
  });

  it('leaves mixed or opaque shell commands as Bash', () => {
    expect(presentCodexCommand({ command: 'cat src/main.ts && pnpm test' })).toBeUndefined();
    expect(presentCodexCommand({ command: 'git status --short' })).toBeUndefined();
    expect(presentCodexCommand({ command: 'cat $(pwd)/src/main.ts' })).toBeUndefined();
  });
});

describe('presentCodexFileChange', () => {
  it('labels native file changes as Edit and summarizes changed paths', () => {
    expect(presentCodexFileChange([
      { path: 'src/main.ts' },
      { path: 'tests/main.test.ts' },
      { path: 'src/main.ts' },
    ])).toEqual({ name: 'Edit', summary: 'src/main.ts +1' });
  });
});
