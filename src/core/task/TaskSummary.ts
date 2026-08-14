import type { Conversation } from '../types';
import type { ConversationReviewProjection } from './ConversationReviewProjection';

export interface TaskSummaryDraft {
  path: string;
  content: string;
}

export interface TaskSummaryFolderVault {
  getAbstractFileByPath(path: string): unknown;
  createFolder(path: string): Promise<unknown>;
}

export function buildTaskSummaryDraft(
  conversation: Conversation,
  projection: ConversationReviewProjection,
  path: string,
  now = Date.now(),
): TaskSummaryDraft {
  const goal = projection.goal || 'No goal recorded.';
  const result = projection.latestAssistantResult || 'No assistant result recorded.';
  const changes = projection.changedFiles.length > 0
    ? projection.changedFiles.map(file => `- [[${file.path}]] (+${file.added}/-${file.removed})`).join('\n')
    : '- No file changes reported.';
  const followUps = projection.unresolvedInteractions.length > 0
    ? projection.unresolvedInteractions.map(item => `- Unresolved ${item.kind}: ${item.toolId}`).join('\n')
    : '- None reported.';
  const plan = projection.latestPlan ? `\n## Plan\n${projection.latestPlan}\n` : '';
  const workerResults = formatWorkerResults(projection);

  return {
    path,
    content: [
      '---',
      'type: claudian-task',
      `conversation: ${conversation.id}`,
      `provider: ${conversation.providerId}`,
      `completed: ${new Date(now).toISOString()}`,
      '---',
      '',
      `# ${conversation.title.trim() || 'Claudian task'}`,
      '',
      '## Goal',
      goal,
      plan,
      '## Result',
      result,
      '',
      '## Changes',
      changes,
      '',
      '## Decisions and follow-ups',
      followUps,
      workerResults,
      '',
    ].join('\n'),
  };
}

function formatWorkerResults(projection: ConversationReviewProjection): string {
  const plan = projection.task?.orchestratorPlan;
  if (!plan || plan.subtasks.length === 0) return '';
  const results = plan.subtasks.map(subtask => {
    const detail = subtask.error || subtask.result || 'No result recorded.';
    return `- **${subtask.title}** (${subtask.status}): ${detail.replace(/\n+/g, ' ').trim()}`;
  });
  return `\n## Worker results\n${results.join('\n')}`;
}

export function normalizeTaskSummaryPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

export function isSafeTaskSummaryPath(path: string): boolean {
  if (path.trim().startsWith('/') || path.trim().startsWith('\\')) return false;
  const normalized = normalizeTaskSummaryPath(path);
  if (!normalized || !normalized.toLowerCase().endsWith('.md')) return false;
  if (/^[A-Za-z]:/.test(path) || normalized.startsWith('~')) return false;
  return !normalized.split('/').some(segment => segment === '..' || segment === '');
}

export async function ensureTaskSummaryParentFolder(
  vault: TaskSummaryFolderVault,
  summaryPath: string,
  isFolder: (file: unknown) => boolean,
): Promise<void> {
  const segments = normalizeTaskSummaryPath(summaryPath).split('/');
  segments.pop();

  let currentPath = '';
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const existing = vault.getAbstractFileByPath(currentPath);
    if (existing) {
      if (!isFolder(existing)) {
        throw new Error(`Cannot create summary folder because ${currentPath} is a file.`);
      }
      continue;
    }
    await vault.createFolder(currentPath);
  }
}

export function defaultTaskSummaryPath(conversation: Conversation): string {
  const title = (conversation.title.trim() || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'task';
  return `Claudian Tasks/${title}-${conversation.id.slice(0, 8)}.md`;
}
