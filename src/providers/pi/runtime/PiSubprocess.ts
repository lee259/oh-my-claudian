import * as fs from 'node:fs';
import * as path from 'node:path';

import { ManagedSubprocess } from '@/core/process/ManagedSubprocess';
import {
  cliPathRequiresNode,
  findNodeExecutable,
  getEnhancedPath,
} from '@/utils/env';

const STDERR_BUFFER_LIMIT = 8_000;
const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';
const PI_MANAGED_LAUNCHER = 'pi-launcher.js';
const PI_MANAGED_RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export interface PiSubprocessLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export class PiSubprocess extends ManagedSubprocess {
  constructor(launchSpec: PiSubprocessLaunchSpec) {
    const enhancedPath = getEnhancedPath(
      launchSpec.env.PATH,
      path.isAbsolute(launchSpec.command) ? launchSpec.command : undefined,
    );
    const processSpec = resolvePiProcessSpec(launchSpec, enhancedPath);
    super({
      ...launchSpec,
      ...processSpec,
      env: {
        ...launchSpec.env,
        PATH: enhancedPath,
      },
      stderrBufferLimit: STDERR_BUFFER_LIMIT,
    });
  }
}

export function resolvePiProcessSpec(
  launchSpec: PiSubprocessLaunchSpec,
  enhancedPath: string,
): Pick<PiSubprocessLaunchSpec, 'args' | 'command'> {
  const command = launchSpec.command.trim();
  if (process.platform !== 'win32') {
    return { args: launchSpec.args, command };
  }

  let nodeEntrypoint: string | null = null;
  if (isWindowsPiLauncher(command)) {
    nodeEntrypoint = resolveInstalledPiBin(command);
    if (!nodeEntrypoint) {
      throw new Error(
        `The Pi Windows launcher could not be resolved to its Node.js entry point: ${command}. `
          + `Set the Pi CLI path to the ${PI_PACKAGE_NAME} package's dist/bundle/cli.js instead.`,
      );
    }
  } else if (cliPathRequiresNode(command)) {
    nodeEntrypoint = command;
  }

  if (!nodeEntrypoint) {
    return { args: launchSpec.args, command };
  }

  const nodeExecutable = findNodeExecutable(enhancedPath);
  if (!nodeExecutable) {
    throw new Error(
      'Pi requires Node.js, but node.exe was not found on PATH. Install Node.js or configure a native Pi executable.',
    );
  }
  return {
    args: [nodeEntrypoint, ...launchSpec.args],
    command: nodeExecutable,
  };
}

function isWindowsPiLauncher(command: string): boolean {
  const extension = path.extname(command).toLowerCase();
  return extension === '.cmd' || extension === '.ps1';
}

function resolveInstalledPiBin(command: string): string | null {
  const basename = path.basename(command).toLowerCase();
  let shimTarget: string | null = null;
  if (basename === 'pi.cmd') {
    shimTarget = readWindowsCommandShimTarget(command);
  } else if (basename === 'pi.ps1') {
    shimTarget = readManagedPowerShellLauncherTarget(command);
  }
  if (!shimTarget) return null;

  return resolveOwningPiPackageBin(shimTarget) ?? resolveManagedPiReleaseBin(shimTarget);
}

function readWindowsCommandShimTarget(command: string): string | null {
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

// The pi.dev managed installer's PowerShell launcher runs its sibling
// pi-launcher.js; any other PowerShell script is unproved.
function readManagedPowerShellLauncherTarget(command: string): string | null {
  try {
    const contents = fs.readFileSync(command, 'utf8');
    const declaresLauncher = contents.split(/\r?\n/u).some(line => (
      /^\$launcher\s*=\s*Join-Path\s+\$basedir\s+"pi-launcher\.js"$/iu.test(line.trim())
    ));
    return declaresLauncher
      ? path.join(path.dirname(command), PI_MANAGED_LAUNCHER)
      : null;
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

function resolveOwningPiPackageBin(target: string): string | null {
  const resolvedTarget = path.resolve(target);
  let current = path.dirname(resolvedTarget);
  while (true) {
    const binPath = readPiPackageBin(current);
    if (binPath && pathsEqual(binPath, resolvedTarget)) return binPath;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

// pi.dev managed installs keep launchers in <root>/bin and versioned releases
// under <root>/install, selected by its current-version file.
function resolveManagedPiReleaseBin(launcher: string): string | null {
  if (path.basename(launcher).toLowerCase() !== PI_MANAGED_LAUNCHER) return null;

  const installRoot = path.resolve(path.dirname(launcher), '..', 'install');
  try {
    if (!fs.statSync(launcher).isFile()) return null;
    const marker = JSON.parse(
      fs.readFileSync(path.join(installRoot, 'managed-install.json'), 'utf8'),
    ) as { kind?: unknown; layout?: unknown; schemaVersion?: unknown };
    if (
      marker.kind !== 'pi-managed-install'
      || marker.schemaVersion !== 1
      || marker.layout !== 'releases-v1'
    ) {
      return null;
    }

    const version = fs.readFileSync(path.join(installRoot, 'current-version'), 'utf8').trim();
    if (!PI_MANAGED_RELEASE_VERSION.test(version)) return null;
    return readPiPackageBin(path.join(
      installRoot,
      'releases',
      version,
      'node_modules',
      ...PI_PACKAGE_NAME.split('/'),
    ));
  } catch {
    return null;
  }
}

function pathsEqual(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function readPiPackageBin(packageRoot: string): string | null {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as {
      bin?: string | Record<string, unknown>;
      name?: unknown;
    };
    if (packageJson.name !== PI_PACKAGE_NAME) return null;
    const relativeBin = typeof packageJson.bin === 'object'
      && packageJson.bin !== null
      && typeof packageJson.bin.pi === 'string'
      ? packageJson.bin.pi
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
