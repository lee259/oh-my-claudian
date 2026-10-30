import * as path from 'node:path';


export interface BuildHermesLaunchSpecParams {
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  additionalArguments?: readonly string[];
}

export interface HermesLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export function buildHermesLaunchSpec(params: BuildHermesLaunchSpecParams): HermesLaunchSpec {
  return {
    args: ['acp', ...(params.additionalArguments ?? [])],
    command: params.command,
    cwd: params.cwd,
    env: withCommandDirectoryOnPath(params.command, params.env ?? process.env),
  };
}

function withCommandDirectoryOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const commandPath = command.trim();
  if (!path.isAbsolute(commandPath)) return env;

  const commandDirectory = path.dirname(commandPath);
  const existingPath = env.PATH ?? '';
  const entries = existingPath.split(path.delimiter).filter(Boolean);
  if (entries.includes(commandDirectory)) return env;
  return { ...env, PATH: [commandDirectory, ...entries].join(path.delimiter) };
}
