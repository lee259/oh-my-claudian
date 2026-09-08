/**
 * Cross-module event contract for opening the read-only subagent transcript
 * overlay. Dispatched by async subagent cards (bubbling DOM event) and
 * consumed by the conversation controller. Kept in its own module so the
 * renderer does not become the import target of the controller.
 */

/** Bubbling DOM event name dispatched from an async subagent card. */
export const OPEN_SUBAGENT_TRANSCRIPT_EVENT = 'claudian:open-subagent-transcript';

/** Statuses the transcript overlay can reflect. */
export type SubagentTranscriptStatus = 'running' | 'completed' | 'error' | 'orphaned';

/** Statuses that stop live transcript polling. */
export const SUBAGENT_TRANSCRIPT_TERMINAL_STATUSES = [
  'completed',
  'error',
  'orphaned',
] as const satisfies readonly SubagentTranscriptStatus[];

export interface OpenSubagentTranscriptDetail {
  /** Tool-use id of the Agent task that spawned the subagent. */
  taskToolId: string;
  /** Runtime agent id (agent-{id}); required to load the sidecar transcript. */
  agentId?: string;
  /** Human-readable task description shown in the panel heading. */
  description?: string;
  status?: SubagentTranscriptStatus;
}

export function isTerminalSubagentTranscriptStatus(
  status: string | undefined,
): status is 'completed' | 'error' | 'orphaned' {
  return (
    status !== undefined
    && (SUBAGENT_TRANSCRIPT_TERMINAL_STATUSES as readonly string[]).includes(status)
  );
}
