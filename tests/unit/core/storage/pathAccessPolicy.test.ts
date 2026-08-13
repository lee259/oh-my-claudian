import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import {
  evaluatePathAccess,
  resolveAllowedFileOperationPath,
} from '@/core/storage/pathAccessPolicy';

describe('path access policy', () => {
  it('allows vault-relative and absolute paths inside the vault', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'claudian-path-policy-'));
    mkdirSync(path.join(root, 'notes'));
    writeFileSync(path.join(root, 'notes', 'today.md'), 'today');

    try {
      expect(evaluatePathAccess({
        operation: 'read',
        requestedPath: 'notes/today.md',
        workspaceRoot: root,
      })).toMatchObject({
        outcome: 'allow',
        path: path.join(realpathSync.native(root), 'notes', 'today.md'),
      });
      expect(resolveAllowedFileOperationPath({
        operation: 'write',
        requestedPath: path.join(root, 'notes', 'new.md'),
        workspaceRoot: root,
      })).toBe(path.join(realpathSync.native(root), 'notes', 'new.md'));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('denies traversal and symlinks that resolve outside the vault', () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'claudian-path-policy-'));
    const workspaceRoot = path.join(testRoot, 'vault');
    const outsideRoot = path.join(testRoot, 'outside');
    mkdirSync(workspaceRoot);
    mkdirSync(outsideRoot);
    writeFileSync(path.join(outsideRoot, 'secret.md'), 'secret');
    symlinkSync(path.join(outsideRoot, 'secret.md'), path.join(workspaceRoot, 'linked.md'));

    try {
      expect(evaluatePathAccess({
        operation: 'read',
        requestedPath: '../outside/secret.md',
        workspaceRoot,
      })).toMatchObject({ outcome: 'deny' });
      expect(evaluatePathAccess({
        operation: 'read',
        requestedPath: 'linked.md',
        workspaceRoot,
      })).toMatchObject({ outcome: 'deny' });
    } finally {
      rmSync(testRoot, { force: true, recursive: true });
    }
  });

  it('returns needsApproval for an external path until it is authorized', () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'claudian-path-policy-'));
    const workspaceRoot = path.join(testRoot, 'vault');
    const outsideRoot = path.join(testRoot, 'external');
    mkdirSync(workspaceRoot);
    mkdirSync(outsideRoot);

    try {
      expect(evaluatePathAccess({
        externalPathMode: 'needsApproval',
        operation: 'read',
        requestedPath: path.join(outsideRoot, 'context.md'),
        workspaceRoot,
      })).toMatchObject({
        outcome: 'needsApproval',
        path: path.join(realpathSync.native(outsideRoot), 'context.md'),
      });
    } finally {
      rmSync(testRoot, { force: true, recursive: true });
    }
  });

  it('allows missing files below an existing in-vault directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'claudian-path-policy-'));
    mkdirSync(path.join(root, 'notes'));

    try {
      expect(resolveAllowedFileOperationPath({
        operation: 'write',
        requestedPath: 'notes/new/deep.md',
        workspaceRoot: root,
      })).toBe(path.join(realpathSync.native(root), 'notes', 'new', 'deep.md'));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
