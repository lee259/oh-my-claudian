import {
  agentAttentionIsBusy,
  resolveAgentAttentionPhase,
} from '@/core/execution/AgentAttention';

describe('resolveAgentAttentionPhase', () => {
  it('puts a pending interaction ahead of streaming', () => {
    expect(resolveAgentAttentionPhase({
      isStreaming: true,
      requiresAction: true,
      reviewPending: true,
    })).toBe('needs-you');
  });

  it('reports a running turn that needs nothing as working', () => {
    expect(resolveAgentAttentionPhase({
      isStreaming: true,
      requiresAction: false,
      reviewPending: false,
    })).toBe('working');
  });

  it('reports a new turn as working instead of keeping an old review', () => {
    expect(resolveAgentAttentionPhase({
      isStreaming: true,
      requiresAction: false,
      reviewPending: true,
    })).toBe('working');
  });

  it('reports finished output the user has not reviewed as done', () => {
    expect(resolveAgentAttentionPhase({
      isStreaming: false,
      requiresAction: false,
      reviewPending: true,
    })).toBe('done');
  });

  it('reports a turn the user stopped as rest, because a stop is not news', () => {
    expect(resolveAgentAttentionPhase({
      isStreaming: false,
      requiresAction: false,
      reviewPending: false,
    })).toBe('rest');
  });
});

describe('agentAttentionIsBusy', () => {
  it('treats only running or blocked phases as busy', () => {
    expect(agentAttentionIsBusy('working')).toBe(true);
    expect(agentAttentionIsBusy('needs-you')).toBe(true);
    expect(agentAttentionIsBusy('done')).toBe(false);
    expect(agentAttentionIsBusy('rest')).toBe(false);
  });
});
