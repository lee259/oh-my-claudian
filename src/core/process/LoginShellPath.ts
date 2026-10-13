import { execFile } from 'node:child_process';

import { buildShellCommand } from '@/utils/shell';

let cachedPath: string | null = null;
let pending: Promise<void> | null = null;
let loaded = false;
const MARKER = '__CLAUDIAN_LOGIN_PATH__';

export function getLoginShellPath(): string | null {
  return cachedPath;
}

/** Load PATH only; provider credentials remain behind their own environment policy. */
export function loadLoginShellPath(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<void> {
  if (pending) return pending;
  if (loaded && !options.force) return Promise.resolve();
  if (process.platform === 'win32') return Promise.resolve();
  const shell = buildShellCommand(`printf '${MARKER}'; printf '%s' "$PATH"`);
  if (!shell) return Promise.resolve();
  pending = new Promise<void>(resolve => {
    execFile(shell.command, shell.args, {
      encoding: 'utf8', timeout: 5000, maxBuffer: 128 * 1024,
      env: process.env, signal: options.signal, windowsHide: true,
    }, (error, stdout) => {
      if (!error) {
        const index = stdout.lastIndexOf(MARKER);
        const value = index >= 0 ? stdout.slice(index + MARKER.length).trim() : '';
        if (value && !/[\r\n\0]/u.test(value)) cachedPath = value;
      }
      loaded = true;
      resolve();
    });
  }).finally(() => { pending = null; });
  return pending;
}
