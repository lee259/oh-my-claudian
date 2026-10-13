import { createHostCliLifecycleAdapter } from '@/core/providers/cli/HostCliLifecycleAdapter';

import { grokCliMetadata } from './GrokCliMetadata';
import { buildGrokRuntimeEnv } from './GrokRuntimeEnvironment';

export const grokCliLifecycle = createHostCliLifecycleAdapter('grok', grokCliMetadata, {
  identityPattern: /grok\s+build|\bstdio\b/iu,
  environment: (host, cliPath) => buildGrokRuntimeEnv(host.settings, cliPath ?? ''),
});
