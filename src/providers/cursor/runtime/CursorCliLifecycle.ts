import { createHostCliLifecycleAdapter } from '@/core/providers/cli/HostCliLifecycleAdapter';

import { CURSOR_CLI_IDENTITY_PATTERN } from './CursorCliIdentity';
import { cursorCliMetadata } from './CursorCliMetadata';

export const cursorCliLifecycle = createHostCliLifecycleAdapter('cursor', cursorCliMetadata, {
  identityPattern: CURSOR_CLI_IDENTITY_PATTERN,
});
