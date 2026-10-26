import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { isPathWithinRoot } from '@/core/storage/pathContainment';

describe('isPathWithinRoot', () => {
  it.each(['root', 'root\\literal'])('retains POSIX backslashes in files under %s', (rootName) => {
    if (process.platform === 'win32') return;
    const tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-posix-path-')));
    try {
      const root = path.join(tempDir, rootName);
      fs.mkdirSync(root);
      const file = path.join(root, 'session\\literal.jsonl');
      fs.writeFileSync(file, '{}');

      expect(isPathWithinRoot(file, root)).toBe(true);
      expect(isPathWithinRoot(path.join(root, 'missing\\literal.jsonl'), root)).toBe(true);
      expect(isPathWithinRoot(path.join(tempDir, `${rootName}-sibling`, 'session.jsonl'), root)).toBe(false);
      expect(isPathWithinRoot(path.join(root, '..', 'outside.jsonl'), root)).toBe(false);

      const outside = path.join(tempDir, 'outside');
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'session.jsonl'), '{}');
      fs.symlinkSync(outside, path.join(root, 'escape'));
      expect(isPathWithinRoot(path.join(root, 'escape', 'session.jsonl'), root)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses path segments instead of string prefixes', () => {
    expect(isPathWithinRoot('/home/user/.codex/sessions/a.jsonl', '/home/user/.codex/sessions')).toBe(true);
    expect(isPathWithinRoot('/home/user/.codex/sessions-evil/a.jsonl', '/home/user/.codex/sessions')).toBe(false);
    expect(isPathWithinRoot('/home/user/.codex/sessions/../secrets/a.jsonl', '/home/user/.codex/sessions')).toBe(false);
  });

  it('supports Windows drive and UNC paths independently of the host platform', () => {
    expect(isPathWithinRoot('C:\\Users\\me\\.codex\\sessions\\a.jsonl', 'C:\\Users\\me\\.codex\\sessions')).toBe(true);
    expect(isPathWithinRoot('D:\\Users\\me\\.codex\\sessions\\a.jsonl', 'C:\\Users\\me\\.codex\\sessions')).toBe(false);
    expect(isPathWithinRoot('\\\\wsl$\\Ubuntu\\home\\me\\.codex\\sessions\\a.jsonl', '\\\\wsl$\\Ubuntu\\home\\me\\.codex\\sessions')).toBe(true);
    expect(isPathWithinRoot('\\\\wsl$\\Other\\home\\me\\.codex\\sessions\\a.jsonl', '\\\\wsl$\\Ubuntu\\home\\me\\.codex\\sessions')).toBe(false);
  });

  it('rejects an existing symlink that escapes the trusted root', () => {
    if (process.platform === 'win32') return;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-path-trust-'));
    const root = path.join(tempDir, 'root');
    const outside = path.join(tempDir, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'session.jsonl'), '{}');
    fs.symlinkSync(outside, path.join(root, 'escape'));

    expect(isPathWithinRoot(path.join(root, 'escape', 'session.jsonl'), root)).toBe(false);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves existing symlinked ancestors before admitting missing history paths', () => {
    const tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-missing-path-')));
    try {
      const root = path.join(tempDir, 'root');
      const outside = path.join(tempDir, 'outside');
      fs.mkdirSync(root);
      fs.mkdirSync(outside);
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';
      fs.symlinkSync(outside, path.join(root, 'escape'), linkType);
      fs.symlinkSync(root, path.join(tempDir, 'root-alias'), linkType);

      expect(isPathWithinRoot(path.join(root, 'escape', 'missing', 'session.jsonl'), root)).toBe(false);
      expect(isPathWithinRoot(`${path.join(root, 'escape')}${path.sep}..${path.sep}missing.jsonl`, root)).toBe(false);
      expect(isPathWithinRoot(path.join(tempDir, 'root-alias', 'missing', 'session.jsonl'), root)).toBe(true);
      expect(isPathWithinRoot(path.join(root, 'missing', 'session.jsonl'), path.join(tempDir, 'root-alias'))).toBe(true);
      expect(isPathWithinRoot(path.relative(process.cwd(), path.join(root, 'escape', 'missing.jsonl')), root)).toBe(false);
      expect(isPathWithinRoot(path.relative(process.cwd(), path.join(root, 'missing.jsonl')), root)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
