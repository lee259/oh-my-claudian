import * as path from 'path';

const VALID_SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash']);

/**
 * Get the user's preferred shell path, validated against allowed shells.
 * Falls back to /bin/zsh on macOS, /bin/bash on Linux.
 */
export function getUserShell(): string {
  const envShell = process.env.SHELL?.trim();
  if (envShell && envShell.startsWith('/')) {
    const basename = path.basename(envShell);
    if (VALID_SHELLS.has(basename)) {
      return envShell;
    }
  }
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
}

/**
 * Build a shell command that loads the user's login profile (e.g., `.zshrc`,
 * `.bashrc`) so that the correct PATH (nvm, homebrew, etc.) is available.
 *
 * Returns `{ command, args }` suitable for `ManagedCommandRunner.run()`.
 * Returns `null` on Windows (where shell fallback should use `cmd /C`).
 */
export function buildShellCommand(
  commandLine: string,
  shell?: string,
): { command: string; args: string[] } | null {
  if (process.platform === 'win32') {
    // On Windows, use cmd /C as the shell fallback.
    return { command: 'cmd', args: ['/C', commandLine] };
  }

  const resolvedShell = shell ?? getUserShell();
  const basename = path.basename(resolvedShell);
  const flag = basename === 'sh' || basename === 'dash' ? '-c' : '-lic';
  return { command: resolvedShell, args: [flag, commandLine] };
}

/**
 * Quote a single argument for shell injection.
 * Uses single quotes when the string contains special characters.
 */
export function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./~@%+-]+$/.test(s)) {
    return s;
  }
  return `'${s.replace(/'/g, `'\\''`)}'`;
}