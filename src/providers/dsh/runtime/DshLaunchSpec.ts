import * as path from 'node:path';

export interface DshLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface BuildDshLaunchSpecParams {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  model?: string;
}

export function buildDshLaunchSpec(params: BuildDshLaunchSpecParams): DshLaunchSpec {
  const model = params.model?.trim() ?? '';
  return {
    args: params.args.map(argument => argument.replaceAll('{model}', model)),
    command: params.command,
    cwd: params.cwd,
    env: withCommandDirectoryOnPath(params.command, params.env),
  };
}

function withCommandDirectoryOnPath(command: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!path.isAbsolute(command)) return env;
  const directory = path.dirname(command);
  const entries = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return entries.includes(directory) ? env : { ...env, PATH: [directory, ...entries].join(path.delimiter) };
}
