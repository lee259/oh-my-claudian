import type { GuardianReviewAction, GuardianReviewCompleted } from '@/providers/codex/runtime/codexAppServerTypes';
import {
  describeAutoReview,
  describeReviewAction,
  guardianOverrideParams,
  isReportedReview,
} from '@/providers/codex/runtime/notifications/codexAutoReview';

function completed(
  action: GuardianReviewAction,
  review: GuardianReviewCompleted['review'] = { rationale: null, riskLevel: null, status: 'denied', userAuthorization: null },
): GuardianReviewCompleted {
  return {
    action,
    decisionSource: 'agent',
    review,
    reviewId: 'review-1',
    targetItemId: null,
    threadId: 'thread-1',
    turnId: 'turn-1',
  };
}

describe('describeReviewAction', () => {
  it('shows a command with its working directory', () => {
    expect(describeReviewAction({ command: 'npm install', cwd: '/vault/site', source: 'shell', type: 'command' }))
      .toBe('npm install (/vault/site)');
  });

  it('lists the files of a patch review', () => {
    expect(describeReviewAction({ cwd: '/vault', files: ['one.md', 'two.md'], type: 'applyPatch' }))
      .toBe('File changes (/vault): one.md, two.md');
  });

  it('names the terminal a stdin write targets', () => {
    expect(describeReviewAction({ approvalId: 'a', cwd: '/vault', processId: 'p1', stdin: 'yes\n', type: 'writeStdin' }))
      .toBe('Terminal input for p1: "yes\\n"');
  });
});

describe('describeAutoReview', () => {
  it('reports a denial with its risk and rationale', () => {
    expect(describeAutoReview(completed(
      { command: 'npm install', cwd: '/vault/site', source: 'shell', type: 'command' },
      { rationale: 'Installs unreviewed code.', riskLevel: 'high', status: 'denied', userAuthorization: null },
    ))).toBe([
      'Auto-review denied ` npm install (/vault/site) `',
      'Risk: high · Installs unreviewed code.',
    ].join('\n\n'));
  });

  it('fences a subject that already contains backticks', () => {
    expect(describeAutoReview(completed(
      { command: 'echo `date`', cwd: '/vault', source: 'shell', type: 'command' },
      { rationale: null, riskLevel: null, status: 'timedOut', userAuthorization: null },
    ))).toBe('Auto-review timed out for `` echo `date` (/vault) ``');
  });
});

describe('isReportedReview', () => {
  it('keeps an approval quiet but reports every other outcome', () => {
    const approved = { rationale: null, riskLevel: null, status: 'approved' as const, userAuthorization: null };
    expect(isReportedReview(completed({ cwd: '/vault', files: ['a.md'], type: 'applyPatch' }, approved))).toBe(false);
    expect(isReportedReview(completed(
      { cwd: '/vault', files: ['a.md'], type: 'applyPatch' },
      { ...approved, status: 'denied' },
    ))).toBe(true);
  });
});

describe('guardianOverrideParams', () => {
  it.each<[GuardianReviewAction, unknown]>([
    [{ command: 'pwd', cwd: '/vault', source: 'unifiedExec', type: 'command' },
      { command: 'pwd', cwd: '/vault', source: 'unified_exec', type: 'command' }],
    [{ cwd: '/vault', files: ['one.md', 'two.md'], type: 'applyPatch' },
      { cwd: '/vault', files: ['one.md', 'two.md'], type: 'apply_patch' }],
    [{ host: 'registry.example', port: 443, protocol: 'socks5Tcp', target: 'https://registry.example', type: 'networkAccess' },
      { host: 'registry.example', port: 443, protocol: 'socks5_tcp', target: 'https://registry.example', type: 'network_access' }],
    [{ connectorId: 'kb', connectorName: 'KB', server: 'docs', toolName: 'read', toolTitle: 'Read docs', type: 'mcpToolCall' },
      { connector_id: 'kb', connector_name: 'KB', server: 'docs', tool_name: 'read', tool_title: 'Read docs', type: 'mcp_tool_call' }],
    [{ approvalId: 'a', cwd: '/vault', processId: 'p1', stdin: 'yes\n', type: 'writeStdin' },
      { approval_id: 'a', cwd: 'file:///vault', process_id: 'p1', stdin: 'yes\n', type: 'write_stdin' }],
    [{ permissions: { fileSystem: { read: ['/vault'], write: ['/vault/notes'] } }, reason: 'Index', type: 'requestPermissions' },
      {
        permissions: {
          file_system: {
            entries: [
              { access: 'read', path: { path: '/vault', type: 'path' } },
              { access: 'write', path: { path: '/vault/notes', type: 'path' } },
            ],
          },
        },
        reason: 'Index',
        type: 'request_permissions',
      }],
  ])('serializes $type for the native denial override', (action, expected) => {
    const params = guardianOverrideParams({
      ...completed(action),
      completedAtMs: 1_000,
      startedAtMs: 900,
    });

    expect(params).toEqual({
      event: {
        action: expected,
        completed_at_ms: 1_000,
        decision_source: 'agent',
        id: 'review-1',
        rationale: null,
        risk_level: null,
        started_at_ms: 900,
        status: 'denied',
        turn_id: 'turn-1',
        user_authorization: null,
      },
      threadId: 'thread-1',
    });
  });
});
