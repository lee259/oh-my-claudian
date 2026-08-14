import {
  approveOrchestratorPlan,
  cancelOrchestratorSubtask,
  createOrchestratorPlan,
  failOrchestratorSubtask,
  getNextRunnableOrchestratorSubtask,
  isOrchestratorPlanTerminal,
  parseOrchestratorPlan,
  rejectOrchestratorPlan,
  transitionOrchestratorSubtask,
} from '@/core/task/OrchestratorPlan';

describe('OrchestratorPlan', () => {
  it('creates a queued plan with provider-neutral subtasks and dependencies', () => {
    const plan = createOrchestratorPlan({
      id: 'plan-1',
      rootConversationId: 'conversation-1',
      goal: 'Ship the feature',
      subtasks: [
        { id: 'research', title: 'Research', description: 'Check the existing design' },
        { id: 'implement', title: 'Implement', description: 'Build the feature', dependsOn: ['research'] },
      ],
      now: 100,
    });

    expect(plan).toEqual({
      schemaVersion: 1,
      id: 'plan-1',
      rootConversationId: 'conversation-1',
      goal: 'Ship the feature',
      approvalStatus: 'pending',
      executionPolicy: { maxConcurrentWorkers: 1, stopOnFailure: true },
      status: 'queued',
      createdAt: 100,
      updatedAt: 100,
      subtasks: [
        { id: 'research', title: 'Research', description: 'Check the existing design', status: 'queued', dependsOn: [], createdAt: 100, updatedAt: 100 },
        { id: 'implement', title: 'Implement', description: 'Build the feature', status: 'queued', dependsOn: ['research'], createdAt: 100, updatedAt: 100 },
      ],
    });
  });

  it('only starts a subtask when all dependencies are completed', () => {
    const plan = createOrchestratorPlan({
      id: 'plan-2',
      rootConversationId: 'conversation-1',
      goal: 'Ship',
      subtasks: [
        { id: 'research', title: 'Research', description: 'Research' },
        { id: 'implement', title: 'Implement', description: 'Implement', dependsOn: ['research'] },
      ],
      now: 100,
    });
    approveOrchestratorPlan(plan, 150);

    expect(() => transitionOrchestratorSubtask(plan, 'implement', 'running', 200))
      .toThrow('Subtask implement is blocked by incomplete dependencies: research');

    transitionOrchestratorSubtask(plan, 'research', 'running', 200);
    transitionOrchestratorSubtask(plan, 'research', 'review', 300);
    transitionOrchestratorSubtask(plan, 'research', 'completed', 400);
    expect(transitionOrchestratorSubtask(plan, 'implement', 'running', 500)).toMatchObject({
      status: 'running',
      updatedAt: 500,
    });
  });

  it('keeps the default execution policy sequential and stops after a failure', () => {
    const plan = createOrchestratorPlan({
      id: 'plan-policy',
      rootConversationId: 'conversation-1',
      goal: 'Ship',
      subtasks: [
        { id: 'a', title: 'A', description: 'A' },
        { id: 'b', title: 'B', description: 'B' },
      ],
      now: 100,
    });
    approveOrchestratorPlan(plan, 110);

    expect(plan.executionPolicy).toEqual({ maxConcurrentWorkers: 1, stopOnFailure: true });
    expect(getNextRunnableOrchestratorSubtask(plan)?.id).toBe('a');
    transitionOrchestratorSubtask(plan, 'a', 'running', 120);
    expect(getNextRunnableOrchestratorSubtask(plan)).toBeNull();
    failOrchestratorSubtask(plan, 'a', 'Failed', 130);
    expect(getNextRunnableOrchestratorSubtask(plan)).toBeNull();
  });

  it('requires explicit approval before subtasks can run', () => {
    const plan = createOrchestratorPlan({
      id: 'plan-approval',
      rootConversationId: 'conversation-1',
      goal: 'Ship',
      subtasks: [{ id: 'research', title: 'Research', description: 'Research' }],
      now: 100,
    });

    expect(() => transitionOrchestratorSubtask(plan, 'research', 'running', 200))
      .toThrow('Orchestrator plan requires approval before execution');
    approveOrchestratorPlan(plan, 200);
    expect(transitionOrchestratorSubtask(plan, 'research', 'running', 300).status).toBe('running');
    expect(plan.approvalStatus).toBe('approved');

    const rejectedPlan = createOrchestratorPlan({
      id: 'plan-rejected',
      rootConversationId: 'conversation-1',
      goal: 'Ship',
      subtasks: [{ id: 'research', title: 'Research', description: 'Research' }],
      now: 100,
    });
    rejectOrchestratorPlan(rejectedPlan, 400);
    expect(rejectedPlan.approvalStatus).toBe('rejected');
  });

  it('rejects missing dependencies and dependency cycles', () => {
    expect(() => createOrchestratorPlan({
      id: 'plan-3',
      rootConversationId: 'conversation-1',
      goal: 'Ship',
      subtasks: [{ id: 'implement', title: 'Implement', description: 'Implement', dependsOn: ['missing'] }],
    })).toThrow('Unknown subtask dependency: missing');

    expect(() => createOrchestratorPlan({
      id: 'plan-4',
      rootConversationId: 'conversation-1',
      goal: 'Ship',
      subtasks: [
        { id: 'a', title: 'A', description: 'A', dependsOn: ['b'] },
        { id: 'b', title: 'B', description: 'B', dependsOn: ['a'] },
      ],
    })).toThrow('Orchestrator subtask dependencies must be acyclic');
  });

  it('fails closed when a persisted plan has invalid status or dependency data', () => {
    const plan = createOrchestratorPlan({
      id: 'plan-5',
      rootConversationId: 'conversation-1',
      goal: 'Ship',
      subtasks: [{ id: 'research', title: 'Research', description: 'Research' }],
      now: 100,
    });

    expect(parseOrchestratorPlan(plan)).toEqual(plan);
    expect(parseOrchestratorPlan({ ...plan, status: 'running' })).toBeUndefined();
    expect(parseOrchestratorPlan({
      ...plan,
      subtasks: [{ ...plan.subtasks[0], dependsOn: ['missing'] }],
    })).toBeUndefined();
  });

  it('records a failed subtask without making the plan look completed', () => {
    const plan = createOrchestratorPlan({
      id: 'plan-failed',
      rootConversationId: 'conversation-1',
      goal: 'Ship',
      subtasks: [{ id: 'research', title: 'Research', description: 'Research' }],
      now: 100,
    });
    approveOrchestratorPlan(plan, 150);
    const failed = failOrchestratorSubtask(plan, 'research', 'Provider timed out', 200);

    expect(failed).toMatchObject({ status: 'failed', error: 'Provider timed out', updatedAt: 200 });
    expect(plan.status).toBe('failed');
  });

  it('recognizes a plan as terminal only after every subtask completed or failed', () => {
    const plan = createOrchestratorPlan({
      id: 'plan-terminal',
      rootConversationId: 'conversation-1',
      goal: 'Ship',
      subtasks: [
        { id: 'a', title: 'A', description: 'A' },
        { id: 'b', title: 'B', description: 'B' },
      ],
      now: 100,
    });
    approveOrchestratorPlan(plan, 110);
    expect(isOrchestratorPlanTerminal(plan)).toBe(false);
    failOrchestratorSubtask(plan, 'a', 'Failed', 120);
    expect(isOrchestratorPlanTerminal(plan)).toBe(false);
    failOrchestratorSubtask(plan, 'b', 'Failed', 130);
    expect(isOrchestratorPlanTerminal(plan)).toBe(true);
  });

  it('cancels an unfinished subtask and derives a cancelled plan state', () => {
    const plan = createOrchestratorPlan({
      id: 'plan-cancelled',
      rootConversationId: 'conversation-1',
      goal: 'Ship',
      subtasks: [{ id: 'research', title: 'Research', description: 'Research' }],
      now: 100,
    });
    approveOrchestratorPlan(plan, 110);
    const cancelled = cancelOrchestratorSubtask(plan, 'research', 120);

    expect(cancelled.status).toBe('cancelled');
    expect(plan.status).toBe('cancelled');
    expect(isOrchestratorPlanTerminal(plan)).toBe(true);
  });
});
