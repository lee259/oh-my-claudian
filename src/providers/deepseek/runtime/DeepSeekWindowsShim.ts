import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The script an npm-family `.cmd` shim runs through Node, or null when the shim is not a proved Node invocation.
 * Shims locate installations; callers launch the owning package entry through Node, never the shim.
 */
export function readWindowsCommandShimTarget(command: string): string | null {
  try {
    const contents = fs.readFileSync(command, 'utf8');
    for (const rawLine of contents.split(/\r?\n/u)) {
      const line = rawLine.trim();
      const relativeMatch = /"%(?:~dp0|dp0%)\\?([^"\r\n]+?)"\s+%\*\s*$/iu.exec(line);
      if (
        relativeMatch?.[1]
        && isSupportedWindowsNodeInvocation(line.slice(0, relativeMatch.index))
      ) {
        const relativeTarget = relativeMatch[1].replace(/[\\/]/gu, path.sep);
        return path.resolve(path.dirname(command), relativeTarget);
      }

      const absoluteMatch = /"([^"\r\n]+)"\s+%\*\s*$/u.exec(line);
      if (
        absoluteMatch?.[1]
        && path.isAbsolute(absoluteMatch[1])
        && isSupportedWindowsNodeInvocation(line.slice(0, absoluteMatch.index))
      ) {
        return path.normalize(absoluteMatch[1]);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** The named package's `bin` entry that is exactly `target`, found in the nearest enclosing package that declares it. */
export function resolveOwningPackageBin(target: string, packageName: string, binName: string): string | null {
  const resolvedTarget = path.resolve(target);
  let current = path.dirname(resolvedTarget);
  while (true) {
    const binPath = readPackageBin(current, packageName, binName);
    if (binPath && pathsEqual(binPath, resolvedTarget)) return binPath;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/** An existing `bin` file the named package declares inside its own root. */
export function readPackageBin(packageRoot: string, packageName: string, binName: string): string | null {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as {
      bin?: string | Record<string, unknown>;
      name?: unknown;
    };
    if (packageJson.name !== packageName) return null;
    const relativeBin = typeof packageJson.bin === 'object'
      && packageJson.bin !== null
      && typeof packageJson.bin[binName] === 'string'
      ? packageJson.bin[binName]
      : null;
    if (!relativeBin) return null;

    const resolvedRoot = path.resolve(packageRoot);
    const resolvedBin = path.resolve(resolvedRoot, relativeBin);
    const relative = path.relative(resolvedRoot, resolvedBin);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return fs.statSync(resolvedBin).isFile() ? resolvedBin : null;
  } catch {
    return null;
  }
}

function isSupportedWindowsNodeInvocation(value: string): boolean {
  const invocation = value.trim().replace(/^@/u, '').trim();
  if (/^node(?:\.exe)?$/iu.test(invocation)) return true;
  if (/^"%~dp0\\node(?:\.exe)?"$/iu.test(invocation)) return true;
  if (/^"(?:[a-z]:[\\/]|\\\\)[^"\r\n]*[\\/]node(?:\.exe)?"$/iu.test(invocation)) {
    return true;
  }
  return /^endLocal\s+&\s+goto\s+#_undefined_#\s+2>NUL\s+\|\|\s+title\s+%COMSPEC%\s+&\s+(?:set\s+PATHEXT=[^&\r\n]+\s+&\s+)?"%_prog%"$/iu.test(invocation);
}

function pathsEqual(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
