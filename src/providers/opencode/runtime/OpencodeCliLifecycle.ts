import { createHostCliLifecycleAdapter } from '@/core/providers/cli/HostCliLifecycleAdapter';

import { opencodeCliMetadata } from './OpencodeCliMetadata';
import { buildOpencodeRuntimeEnv } from './OpencodeRuntimeEnvironment';

export const opencodeCliLifecycle = createHostCliLifecycleAdapter('opencode', opencodeCliMetadata, {
  identityPattern: /\bopencode\b/iu,
  environment: (host, cliPath) => buildOpencodeRuntimeEnv(host.settings, cliPath ?? ''),
});
