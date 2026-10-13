import { createHostCliLifecycleAdapter } from '@/core/providers/cli/HostCliLifecycleAdapter';

import { cursorCliMetadata } from './CursorCliMetadata';

export const cursorCliLifecycle = createHostCliLifecycleAdapter('cursor', cursorCliMetadata, {
  identityPattern: /\bcursor\b|\bacp\b/iu,
});
