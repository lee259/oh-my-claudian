import {
  lstatSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import * as path from 'node:path';

export type FileOperation = 'read' | 'write';
export type PathAccessOutcome = 'allow' | 'deny' | 'needsApproval';

export interface PathAccessRequest {
  readonly externalPathMode?: 'deny' | 'needsApproval';
  readonly operation: FileOperation;
  readonly requestedPath: string;
  readonly workspaceRoot: string;
}

export interface PathAccessDecision {
  readonly outcome: PathAccessOutcome;
  readonly path: string;
  readonly reason: string;
}

export class PathAccessError extends Error {
  constructor(readonly decision: PathAccessDecision) {
    super(decision.reason);
    this.name = 'PathAccessError';
  }
}

export function evaluatePathAccess(request: PathAccessRequest): PathAccessDecision {
  const workspaceRoot = path.resolve(request.workspaceRoot);
  const requestedPath = request.requestedPath.trim();
  if (!requestedPath) {
    return deny(workspaceRoot, 'File access requires a non-empty path.');
  }

  const lexicalPath = path.resolve(workspaceRoot, requestedPath);
  const canonicalRoot = resolveCanonicalPath(workspaceRoot);
  const canonicalPath = resolveCanonicalPath(lexicalPath);
  const lexicalInside = isPathWithinRoot(lexicalPath, workspaceRoot);
  const canonicalInside = isPathWithinRoot(canonicalPath, canonicalRoot);

  if (lexicalInside && canonicalInside) {
    return {
      outcome: 'allow',
      path: canonicalPath,
      reason: `${request.operation} access is within the current workspace.`,
    };
  }

  if (lexicalInside && !canonicalInside) {
    return deny(canonicalPath, 'File access cannot follow a link outside the current workspace.');
  }

  if (request.externalPathMode === 'needsApproval') {
    return {
      outcome: 'needsApproval',
      path: canonicalPath,
      reason: 'File access is outside the current workspace and requires approval.',
    };
  }

  return deny(canonicalPath, 'File access is limited to the current workspace.');
}

export function resolveAllowedFileOperationPath(request: PathAccessRequest): string {
  const decision = evaluatePathAccess(request);
  if (decision.outcome !== 'allow') throw new PathAccessError(decision);
  return decision.path;
}

function deny(targetPath: string, reason: string): PathAccessDecision {
  return { outcome: 'deny', path: targetPath, reason };
}

function resolveCanonicalPath(
  targetPath: string,
  resolvingLinks = new Set<string>(),
): string {
  let current = path.resolve(targetPath);
  const missingSegments: string[] = [];

  while (true) {
    try {
      return path.resolve(realpathSync.native(current), ...missingSegments);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      let linkTarget: string | null = null;
      try {
        if (lstatSync(current).isSymbolicLink()) linkTarget = readlinkSync(current);
      } catch (linkError) {
        if (!isMissingPathError(linkError)) throw linkError;
      }
      if (linkTarget !== null) {
        if (resolvingLinks.has(current)) {
          throw new Error(`Circular symbolic link: ${current}`, { cause: error });
        }
        const next = new Set(resolvingLinks);
        next.add(current);
        const resolvedTarget = path.isAbsolute(linkTarget)
          ? linkTarget
          : path.resolve(path.dirname(current), linkTarget);
        return path.resolve(resolveCanonicalPath(resolvedTarget, next), ...missingSegments);
      }
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missingSegments.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isPathWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}
