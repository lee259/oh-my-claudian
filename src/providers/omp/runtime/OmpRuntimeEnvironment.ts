import { ManagedCommandRunner } from '@/core/process/ManagedCommandRunner';
import { buildShellCommand } from '@/utils/shell';

import { buildOmpEnvironment } from './OmpLaunchSpec';

const LOGIN_ENV_MARKER = '__CLAUDIAN_OMP_LOGIN_ENV__';
const LOGIN_ENV_TIMEOUT_MS = 10_000;
const LOGIN_ENV_STDOUT_LIMIT_BYTES = 4 * 1024 * 1024;

let loginShellEnvironmentPromise: Promise<NodeJS.ProcessEnv> | null = null;

/**
 * Resolve the user's login-shell environment for OMP subprocesses launched by a
 * GUI host. GUI apps do not inherit exports from interactive shell startup files.
 */
export async function resolveOmpRuntimeEnvironment(
  inheritedEnvironment: NodeJS.ProcessEnv,
  configuredEnvironment: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  const loginEnvironment = await getLoginShellEnvironment(inheritedEnvironment);
  return buildOmpEnvironment(
    { ...inheritedEnvironment, ...loginEnvironment },
    configuredEnvironment,
  );
}

async function getLoginShellEnvironment(
  inheritedEnvironment: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  if (process.platform === 'win32') return {};
  if (!loginShellEnvironmentPromise) {
    loginShellEnvironmentPromise = readLoginShellEnvironment(inheritedEnvironment);
  }
  return loginShellEnvironmentPromise;
}

async function readLoginShellEnvironment(
  inheritedEnvironment: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  const shellCommand = buildShellCommand(
    `printf '\\0${LOGIN_ENV_MARKER}\\0'; /usr/bin/env -0`,
  );
  if (!shellCommand) return {};

  try {
    const runner = new ManagedCommandRunner();
    const result = await runner.run({
      args: shellCommand.args,
      command: shellCommand.command,
      cwd: inheritedEnvironment.HOME || process.cwd(),
      env: inheritedEnvironment,
      timeoutMs: LOGIN_ENV_TIMEOUT_MS,
      stdoutLimitBytes: LOGIN_ENV_STDOUT_LIMIT_BYTES,
    });
    if (result.exitCode !== 0 || result.termination) return {};
    return parseLoginShellEnvironment(result.stdout);
  } catch {
    return {};
  }
}

function parseLoginShellEnvironment(output: string): NodeJS.ProcessEnv {
  const entries = output.split('\0');
  const markerIndex = entries.indexOf(LOGIN_ENV_MARKER);
  if (markerIndex < 0) return {};

  const environment: NodeJS.ProcessEnv = {};
  for (const entry of entries.slice(markerIndex + 1)) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    const key = entry.slice(0, separator);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;
    environment[key] = entry.slice(separator + 1);
  }
  return environment;
}
