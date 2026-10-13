import { createHostCliLifecycleAdapter } from '@/core/providers/cli/HostCliLifecycleAdapter';
import { getEnhancedPath, parseEnvironmentVariables } from '@/utils/env';

import { ompCliMetadata } from './OmpCliMetadata';
import { resolveOmpRuntimeEnvironment } from './OmpRuntimeEnvironment';

export const ompCliLifecycle = createHostCliLifecycleAdapter('omp', ompCliMetadata, {
  identityPattern: /\bacp\b|\brpc\b/iu,
  environment: async (host, cliPath) => {
    const configured = parseEnvironmentVariables(host.getActiveEnvironmentVariables('omp'));
    const env = await resolveOmpRuntimeEnvironment(process.env, configured);
    return { ...env, PATH: getEnhancedPath(env.PATH, cliPath ?? undefined) };
  },
});
