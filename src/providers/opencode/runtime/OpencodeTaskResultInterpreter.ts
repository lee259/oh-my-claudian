import { NOOP_TASK_RESULT_INTERPRETER } from '../../../core/providers/NoopTaskResultInterpreter';
import type { ProviderTaskResultInterpreter, ProviderTaskTerminalStatus } from '../../../core/providers/types';
import { extractToolResultContent } from '../../../core/tools/toolResultContent';

const BACKGROUND_LAUNCH = /^The subagent is working in the background \(sessionID: (ses_[^)\s]+)\)/u;
const RESULT_ENVELOPE = /^\s*<subagent sessionID="([^"]+)" state="([^"]*)">\n?([\s\S]*?)\n?<\/subagent>\s*$/u;

/** Interprets OpenCode V2's native child-session result envelopes. */
export const opencodeTaskResultInterpreter: ProviderTaskResultInterpreter = {
  ...NOOP_TASK_RESULT_INTERPRETER,
  hasAsyncLaunchMarker(result) {
    return BACKGROUND_LAUNCH.test(extractToolResultContent(result));
  },
  extractAgentId(result) {
    const text = extractToolResultContent(result);
    return BACKGROUND_LAUNCH.exec(text)?.[1] ?? RESULT_ENVELOPE.exec(text)?.[1] ?? null;
  },
  extractStructuredResult(result) {
    return RESULT_ENVELOPE.exec(extractToolResultContent(result))?.[3] ?? null;
  },
  resolveTerminalStatus(result, fallback: ProviderTaskTerminalStatus) {
    const match = RESULT_ENVELOPE.exec(extractToolResultContent(result));
    return match && match[2] !== 'completed' ? 'error' : fallback;
  },
  extractTagValue(payload, tagName) {
    if (tagName !== 'result' && tagName !== 'output') return null;
    const match = RESULT_ENVELOPE.exec(payload);
    return match?.[3] ?? null;
  },
};
