import { findCliBinaryPath } from '../../../utils/cliBinaryLocator';
import { buildShellCommand, shellQuote } from '../../../utils/shell';
import { ManagedCommandRunner } from '../../process/ManagedCommandRunner';
import type { CliVersionInfo, CliVersionProbeResult } from './CliProviderMetadata';

// Regex to extract semver from CLI --version output (e.g. "grok 2.1.156" → "2.1.156")
const VERSION_RE = /\d+\.\d+\.\d+(-[\w.]+)?/;

interface VersionParts {
  core: [number, number, number];
  pre: string[];
}

function parseVersion(v: string): VersionParts | null {
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.') : [],
  };
}

function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const aNum = /^\d+$/.test(a[i]);
    const bNum = /^\d+$/.test(b[i]);
    if (aNum && bNum) {
      const d = Number(a[i]) - Number(b[i]);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (aNum) {
      return -1;
    } else if (bNum) {
      return 1;
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/**
 * Compare two semver strings. Returns >0 if a > b, <0 if a < b, 0 if equal or
 * either cannot be parsed.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    const d = pa.core[i] - pb.core[i];
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return comparePre(pa.pre, pb.pre);
}

/**
 * Whether an update is available: latest is strictly greater than current.
 */
export function isUpdateAvailable(
  current: string | null | undefined,
  latest: string | null | undefined,
): boolean {
  if (!current || !latest) return false;
  // If current is a prerelease of the same base version as latest (e.g.
  // current=1.2.3-next.1, latest=1.2.3), don't report an update — the user is
  // already on the development track for that release.
  if (current !== latest && current.startsWith(latest)) {
    return false;
  }
  return compareVersions(latest, current) > 0;
}

/**
 * Extract a version string from raw CLI --version output.
 */
export function extractVersion(raw: string): string {
  const match = VERSION_RE.exec(raw);
  return match ? match[0] : raw.trim();
}

/**
 * Probe local CLI version by running `<command> --version`.
 *
 * @param command    - Resolved CLI path or binary name.
 * @param runner     - Optional ManagedCommandRunner instance.
 * @param env        - Optional environment variables to pass.
 * @param binaryName - Binary name for shell fallback lookup (e.g. "codex").
 *                     When provided, the shell fallback runs `<binaryName>
 *                     --version` so the login shell resolves the binary via
 *                     its own PATH after loading the profile — mirroring
 *                     cc-switch's try_get_version. This matters for version
 *                     managers (fnm/nvm/volta) whose bin dirs are only present
 *                     in the shell profile PATH, not in process.env.
 */
export async function probeCliVersion(
  command: string | null,
  runner?: ManagedCommandRunner,
  env?: Record<string, string>,
  binaryName?: string,
): Promise<CliVersionProbeResult> {
  const r = runner ?? new ManagedCommandRunner();
  const mergedEnv = { ...process.env, ...env } as Record<string, string>;

  /** Try probing --version via a single spawn; returns null when the spawn
   *  itself failed (ENOENT) so the caller can retry via shell. */
  const tryProbe = async (cmd: string, args: string[]): Promise<CliVersionProbeResult | null> => {
    try {
      const result = await r.run({
        args,
        command: cmd,
        cwd: process.cwd(),
        env: mergedEnv,
        timeoutMs: 15_000,
        stdoutLimitBytes: 8_192,
        captureStderr: true,
      });

      if (result.termination === 'abort' || result.termination === 'timeout') {
        return { version: null, error: 'Version probe timed out', installedButBroken: false };
      }

      if (result.termination === 'error') {
        return null; // Spawn itself failed — caller may retry via shell.
      }

      if (result.termination === 'output-limit') {
        return { version: null, error: 'Version probe output too large', installedButBroken: true };
      }

      const stdout = result.stdout.trim();
      const stderr = result.stderr?.trim() ?? '';
      const exitCode = result.exitCode;
      const output = stdout || stderr;

      if (output) {
        const version = extractVersion(output);
        const hasVersion = VERSION_RE.test(output);
        if (exitCode === 0 || hasVersion) {
          return {
            version: hasVersion ? version : null,
            error: exitCode !== 0 ? output.slice(0, 200) : null,
            installedButBroken: false,
          };
        }
        // exit 127 means the runner (shell / env) could not find the command
        // or its dependencies (e.g. "env: node: No such file or directory").
        // Don't treat this as final — a different fallback method may succeed.
        if (exitCode === 127) {
          return null;
        }
        return { version: null, error: output.slice(0, 200), installedButBroken: true };
      }

      return { version: null, error: 'CLI not installed or not on PATH', installedButBroken: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { version: null, error: message, installedButBroken: false };
    }
  };

  // First attempt: direct spawn of the resolved command (when available).
  if (command) {
    const result = await tryProbe(command, ['--version']);
    if (result !== null) return result;
  }

  // Second attempt: the resolved path may be stale or absent (e.g. an expired
  // fnm/nvm multishell path captured in process.env). Re-resolve the binary
  // against the provider's runtime PATH (user-configured env) and spawn that.
  if (binaryName) {
    const reResolved = findCliBinaryPath(binaryName, mergedEnv.PATH);
    if (reResolved && reResolved !== command) {
      const result = await tryProbe(reResolved, ['--version']);
      if (result !== null) return result;
    }
  }

  // Fallback: run through user shell (e.g., `bash -lic "codex --version"`)
  // so that the user's login profile PATH (fnm/nvm/homebrew, etc.) is loaded.
  // Use the binary name (not the resolved path) so the shell can find it via
  // its own PATH — same approach as cc-switch's try_get_version.
  const probeName = binaryName ?? command;
  if (probeName) {
    const shellCmd = buildShellCommand(`${shellQuote(probeName)} --version`);
    if (shellCmd) {
      const result = await tryProbe(shellCmd.command, shellCmd.args);
      if (result !== null) return result;
    }
  }

  return { version: null, error: 'CLI not installed or not on PATH', installedButBroken: false };
}

/**
 * Fetch the latest version of an npm package from the registry.
 * Uses fetch() which is available in Obsidian's renderer.
 */
export async function fetchLatestNpmVersion(packageName: string): Promise<string | null> {
  const url = `https://registry.npmjs.org/${packageName}/latest`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const data = await response.json() as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Complete version info for a CLI: local probe + remote latest.
 */
export async function resolveCliVersionInfo(
  command: string | null,
  metadata: {
    binaryName: string;
    npmPackage?: string;
  },
  runner?: ManagedCommandRunner,
  env?: Record<string, string>,
): Promise<CliVersionInfo> {
  // Always probe, even when command is null — the probe's fallback chain
  // (findCliBinaryPath from env PATH + shell fallback with binaryName) can
  // locate the CLI even when the resolver returned null (e.g. stale fnm
  // multishell path in the cache resolved to a now-nonexistent file).
  const probe = await probeCliVersion(command, runner, env, metadata.binaryName);

  let latestVersion: string | null = null;
  if (metadata.npmPackage) {
    latestVersion = await fetchLatestNpmVersion(metadata.npmPackage);
  }

  return {
    version: probe.version,
    latestVersion,
    error: probe.error,
    installedButBroken: probe.installedButBroken,
  };
}
