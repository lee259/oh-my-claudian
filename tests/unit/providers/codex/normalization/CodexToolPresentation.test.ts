import {
  presentCodexCommand,
  presentCodexFileChange,
  presentCodexImageTool,
  presentCodexMcpToolCall,
} from '@/providers/codex/normalization/CodexToolPresentation';

it('labels only explicit image tools and leaves ordinary file reads alone', () => {
  expect(presentCodexImageTool('image_gen__imagegen')).toEqual({ name: 'GenerateImage' });
  expect(presentCodexImageTool('view_image')).toEqual({ name: 'ViewImage' });
  expect(presentCodexImageTool('Read')).toBeUndefined();
});

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

  it.each([
    [[{ path: 'src/new.ts', kind: 'add' }], 'Create'],
    [[{ path: 'src/old.ts', kind: { type: 'delete' } }], 'Delete'],
    [[{ path: 'src/new.ts', kind: 'add' }, { path: 'src/main.ts', kind: 'update' }], 'Edit'],
    [[{ path: 'src/old.ts', kind: { type: 'update', move_path: 'src/new.ts' } }], 'Edit'],
  ])('uses the native change kind for %j', (changes, name) => {
    const summary = changes.length > 1 ? `${changes[0].path} +${changes.length - 1}` : changes[0].path;
    expect(presentCodexFileChange(changes)).toEqual({ name, summary });
  });

  it('keeps a single change without a kind as a generic edit', () => {
    expect(presentCodexFileChange([{ path: 'src/main.ts', kind: 'modify' }]))
      .toEqual({ name: 'Edit', summary: 'src/main.ts' });
  });
});

describe('presentCodexMcpToolCall', () => {
  it('reads as server and tool instead of the raw MCP id', () => {
    expect(presentCodexMcpToolCall('github', 'search_code'))
      .toEqual({ name: 'github', summary: 'search_code' });
  });

  it.each([
    ['', 'search', { name: 'MCP', summary: 'search' }],
    ['github', '', { name: 'github' }],
    ['', '', { name: 'MCP' }],
  ])('keeps a partial server/tool pair readable', (server, tool, expected) => {
    expect(presentCodexMcpToolCall(server, tool)).toEqual(expected);
  });
});
