const BLOCKED_STOP_PREFIX = 'blocked stop: ';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The feedback of the Stop hooks that blocked a prompt's end, from a Grok
 * `hook_execution` update, or null for any other update.
 */
export function getGrokStopHookFeedback(update: unknown): string | null {
  if (!isRecord(update) || update.sessionUpdate !== 'hook_execution' || update.event_name !== 'stop'
    || typeof update.prompt_id !== 'string' || !Array.isArray(update.runs)) return null;
  const feedback = update.runs.flatMap((run: unknown) => {
    const status = isRecord(run) && isRecord(run.status) ? run.status : null;
    if (status?.blocked !== true) return [];
    const error = typeof status.error === 'string' ? status.error : '';
    const text = (error.startsWith(BLOCKED_STOP_PREFIX) ? error.slice(BLOCKED_STOP_PREFIX.length) : error).trim();
    return [text];
  });
  return feedback.length > 0 ? feedback.filter(Boolean).join('\n\n') : null;
}
