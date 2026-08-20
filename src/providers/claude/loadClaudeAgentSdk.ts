import type {
  query as claudeAgentQuery,
  startup as claudeAgentStartup,
} from '@anthropic-ai/claude-agent-sdk';

import type * as ClaudeAgentQueryModule from './claudeAgentQueryModule';

let modulePromise: Promise<typeof ClaudeAgentQueryModule> | undefined;

export function loadClaudeAgentQuery(): Promise<typeof claudeAgentQuery> {
  modulePromise ??= import('./claudeAgentQueryModule');
  return modulePromise.then(({ query }) => query);
}

export function loadClaudeAgentStartup(): Promise<typeof claudeAgentStartup> {
  modulePromise ??= import('./claudeAgentQueryModule');
  return modulePromise.then(({ startup }) => startup);
}
