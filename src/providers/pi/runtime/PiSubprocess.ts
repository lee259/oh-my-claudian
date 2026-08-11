import * as path from 'node:path';

import { ManagedSubprocess } from '@/core/process/ManagedSubprocess';
import { getEnhancedPath } from '@/utils/env';

const STDERR_BUFFER_LIMIT = 8_000;

export interface PiSubprocessLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export class PiSubprocess extends ManagedSubprocess {
  constructor(launchSpec: PiSubprocessLaunchSpec) {
    super({
      ...launchSpec,
      env: {
        ...launchSpec.env,
        PATH: getEnhancedPath(
          launchSpec.env.PATH,
          path.isAbsolute(launchSpec.command) ? launchSpec.command : undefined,
        ),
      },
      stderrBufferLimit: STDERR_BUFFER_LIMIT,
    });
  }
}
