import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProviderHistoryPathContext } from '../../../core/providers/types';
import { isPathWithinRoot } from '../../../core/storage/pathContainment';
import { findPiSessionFile, findPiSessionFileInRoot } from './PiHistoryStore';

function resolveLocalDirectory(value: string | undefined, home: string, cwd: string): string | null {
  let directory = value?.trim();
  if (!directory) return null;
  try {
    if (directory === '~') directory = home;
    else if (directory.startsWith('~/') || (process.platform === 'win32' && directory.startsWith('~\\'))) {
      directory = path.join(home, directory.slice(2));
    } else if (directory.startsWith('file://')) {
      directory = fileURLToPath(directory);
    }
    return path.resolve(cwd, directory);
  } catch {
    // Invalid native file URLs cannot establish a configured history root.
    return null;
  }
}

function getTrustedRoots(
  vaultPath: string | null,
  context: ProviderHistoryPathContext,
): string[] {
  const roots: string[] = [];
  const windows = (context.hostPlatform ?? process.platform) === 'win32';
  const home = (windows
    ? context.environment.USERPROFILE?.trim() || context.environment.HOME?.trim()
    : context.environment.HOME?.trim() || context.environment.USERPROFILE?.trim()) || os.homedir();
  const cwd = vaultPath ?? context.vaultPath ?? process.cwd();
  const configuredSessionDir = resolveLocalDirectory(
    context.environment.PI_CODING_AGENT_SESSION_DIR,
    home,
    cwd,
  );
  if (configuredSessionDir) {
    roots.push(configuredSessionDir);
  }

  const configuredAgentDir = resolveLocalDirectory(context.environment.PI_CODING_AGENT_DIR, home, cwd);
  if (configuredAgentDir) {
    roots.push(path.join(configuredAgentDir, 'sessions'));
  }
  if (vaultPath) {
    const vaultSessionRoot = path.join(vaultPath, '.pi', 'agent', 'sessions');
    if (isPathWithinRoot(vaultSessionRoot, vaultPath)) {
      roots.push(vaultSessionRoot);
    }
  }
  roots.push(path.join(home, '.pi', 'agent', 'sessions'));
  return [...new Set(roots)];
}

function isLogicalSessionId(value: string | null | undefined): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && !isPiSessionPathReference(value);
}

export function isPiSessionPathReference(
  value: string | null | undefined,
): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && (
    trimmed.includes('/')
    || trimmed.includes('\\')
    || trimmed.endsWith('.jsonl')
  );
}

export function resolvePiSessionFileHint(
  persistedPath: string | null | undefined,
  logicalSessionId: string | null | undefined,
  vaultPath: string | null,
  context?: ProviderHistoryPathContext,
): string | null {
  if (!context) {
    const target = persistedPath ?? logicalSessionId;
    return target ? findPiSessionFile(target, vaultPath) : null;
  }

  const roots = getTrustedRoots(vaultPath, context);
  const pathReference = persistedPath?.trim()
    || (isPiSessionPathReference(logicalSessionId)
      ? logicalSessionId.trim()
      : null);
  const resolvedPathReference = pathReference
    ? path.resolve(vaultPath ?? process.cwd(), pathReference)
    : null;
  if (
    resolvedPathReference
    && roots.some(root => isPathWithinRoot(resolvedPathReference, root))
    && isFile(resolvedPathReference)
  ) {
    return resolvedPathReference;
  }
  if (!isLogicalSessionId(logicalSessionId)) {
    return null;
  }

  for (const root of roots) {
    const resolved = findPiSessionFileInRoot(logicalSessionId, root);
    if (resolved && isPathWithinRoot(resolved, root) && isFile(resolved)) {
      return resolved;
    }
  }
  return null;
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
