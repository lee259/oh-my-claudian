import { createHostCliLifecycleAdapter } from '@/core/providers/cli/HostCliLifecycleAdapter';

import { claudeCliMetadata } from './ClaudeCliMetadata';

export const claudeCliLifecycle = createHostCliLifecycleAdapter('claude', claudeCliMetadata, {
  identityPattern: /\bclaude\b/iu,
});
