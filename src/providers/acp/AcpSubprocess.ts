import { ManagedSubprocess } from '@/core/process/ManagedSubprocess';

const STDERR_BUFFER_LIMIT = 8_000;

export interface AcpSubprocessLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export class AcpSubprocess extends ManagedSubprocess {
  constructor(launchSpec: AcpSubprocessLaunchSpec) {
    super({
      ...launchSpec,
      stderrBufferLimit: STDERR_BUFFER_LIMIT,
    });
  }
}
