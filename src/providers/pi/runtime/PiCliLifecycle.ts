import { createHostCliLifecycleAdapter } from '@/core/providers/cli/HostCliLifecycleAdapter';

import { piCliMetadata } from './PiCliMetadata';
import { resolvePiProcessSpec } from './PiSubprocess';

export const piCliLifecycle = createHostCliLifecycleAdapter('pi', piCliMetadata, {
  identityPattern: /coding.agent|\brpc\b/iu,
  command: (_host, cliPath, args, environment) => resolvePiProcessSpec({
    command: cliPath, args, env: environment, cwd: process.cwd(),
  }, environment.PATH ?? ''),
});
