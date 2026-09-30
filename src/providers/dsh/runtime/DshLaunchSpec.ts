import * as path from 'node:path';

import { findCliBinaryPath } from '@/utils/cliBinaryLocator';

export interface DshLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface BuildDshLaunchSpecParams {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  profilePatchPath?: string;
}

export function buildDshLaunchSpec(params: BuildDshLaunchSpecParams): DshLaunchSpec {
  return {
    args: [
      '--profile', 'acp',
      ...(params.profilePatchPath ? ['--patch', params.profilePatchPath] : []),
    ],
    command: params.command,
    cwd: params.cwd,
    env: withCommandDirectoryOnPath(params.command, params.env),
  };
}

/** Prefer a login-PATH install over an auto-discovered wrapper, while honoring an explicit user path. */
export function resolveDshLaunchCommand(
  resolvedCommand: string,
  env: NodeJS.ProcessEnv,
  hasConfiguredPath: boolean,
): string {
  if (hasConfiguredPath) return resolvedCommand;
  return findCliBinaryPath('dsh', env.PATH) ?? resolvedCommand;
}

function withCommandDirectoryOnPath(command: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!path.isAbsolute(command)) return env;
  const directory = path.dirname(command);
  const entries = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return entries.includes(directory)
    ? env
    : { ...env, PATH: [directory, ...entries].join(path.delimiter) };
}
