/**
 * What a tab is asking of the user right now. Attention is single-valued: a pending interaction outranks a running
 * turn, and a stopped turn leaves nothing to report.
 */
export type AgentAttentionPhase = 'needs-you' | 'working' | 'done' | 'rest';

export interface AgentAttentionFacts {
  readonly isStreaming: boolean;
  readonly requiresAction: boolean;
  /** Finished output the user has not acknowledged. */
  readonly reviewPending: boolean;
}

export function resolveAgentAttentionPhase(facts: AgentAttentionFacts): AgentAttentionPhase {
  if (facts.requiresAction) return 'needs-you';
  if (facts.isStreaming) return 'working';
  return facts.reviewPending ? 'done' : 'rest';
}

/** Only executing and blocked phases own live work; `done` and `rest` are settled. */
export function agentAttentionIsBusy(phase: AgentAttentionPhase): boolean {
  return phase === 'working' || phase === 'needs-you';
}
