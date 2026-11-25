import { t } from '@/i18n/i18n';

import type { GuardianReviewAction, GuardianReviewCompleted } from '../codexAppServerTypes';

export function describeReviewAction(action: GuardianReviewAction): string {
  switch (action.type) {
    case 'command': return `${action.command} (${action.cwd})`;
    case 'execve': return `${action.program} ${JSON.stringify(action.argv)} (${action.cwd})`;
    case 'writeStdin': return t('chat.approval.review.terminalInput', { input: JSON.stringify(action.stdin), process: action.processId });
    case 'applyPatch': return `${t('chat.approval.review.fileChange')} (${action.cwd}): ${action.files.join(', ')}`;
    case 'networkAccess': return `${action.protocol} ${action.target} (${action.host}:${action.port})`;
    case 'mcpToolCall': return `${action.server}/${action.toolName}`;
    case 'requestPermissions': return [action.reason, JSON.stringify(action.permissions)].filter(Boolean).join(' · ');
  }
}

/** Like the Codex TUI, an approved review leaves no chat history; other outcomes are reported. */
export function isReportedReview(event: GuardianReviewCompleted): boolean {
  return event.review.status !== 'approved';
}

export function describeAutoReview(event: GuardianReviewCompleted): string {
  const subject = describeReviewAction(event.action);
  const longestRun = (subject.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(longestRun + 1);
  const status = t(`chat.approval.review.${event.review.status}`, { action: `${fence} ${subject} ${fence}` });
  const { riskLevel, rationale } = event.review;
  const risk = riskLevel && t('chat.approval.review.risk', { level: t(`chat.approval.review.riskLevels.${riskLevel}`) });
  return [status, [risk, rationale].filter(Boolean).join(' · ')].filter(Boolean).join('\n\n');
}
