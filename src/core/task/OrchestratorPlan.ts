export const ORCHESTRATOR_PLAN_SCHEMA_VERSION = 1 as const;

export type OrchestratorSubtaskStatus = 'queued' | 'running' | 'review' | 'completed' | 'failed' | 'cancelled';
export type OrchestratorPlanStatus = 'queued' | 'running' | 'review' | 'completed' | 'failed' | 'cancelled';
export type OrchestratorApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface OrchestratorSubtask {
  id: string;
  title: string;
  description: string;
  status: OrchestratorSubtaskStatus;
  dependsOn: string[];
  createdAt: number;
  updatedAt: number;
  conversationId?: string;
  result?: string;
  error?: string;
}

export interface OrchestratorPlan {
  schemaVersion: typeof ORCHESTRATOR_PLAN_SCHEMA_VERSION;
  id: string;
  rootConversationId: string;
  goal: string;
  approvalStatus: OrchestratorApprovalStatus;
  executionPolicy: OrchestratorExecutionPolicy;
  status: OrchestratorPlanStatus;
  createdAt: number;
  updatedAt: number;
  subtasks: OrchestratorSubtask[];
}

export interface OrchestratorExecutionPolicy {
  maxConcurrentWorkers: number;
  stopOnFailure: boolean;
}

export interface OrchestratorSubtaskInput {
  id: string;
  title: string;
  description: string;
  dependsOn?: string[];
}

export interface CreateOrchestratorPlanInput {
  id: string;
  rootConversationId: string;
  goal: string;
  subtasks: OrchestratorSubtaskInput[];
  now?: number;
  executionPolicy?: Partial<OrchestratorExecutionPolicy>;
}

export function createOrchestratorPlan(input: CreateOrchestratorPlanInput): OrchestratorPlan {
  const now = input.now ?? Date.now();
  const executionPolicy = normalizeExecutionPolicy(input.executionPolicy);
  const subtasks = input.subtasks.map(subtask => ({
    ...subtask,
    dependsOn: [...(subtask.dependsOn ?? [])],
    status: 'queued' as const,
    createdAt: now,
    updatedAt: now,
  }));
  validatePlanInputs(subtasks);

  return {
    schemaVersion: ORCHESTRATOR_PLAN_SCHEMA_VERSION,
    id: input.id,
    rootConversationId: input.rootConversationId,
    goal: input.goal,
    approvalStatus: 'pending',
    executionPolicy,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    subtasks,
  };
}

export function transitionOrchestratorSubtask(
  plan: OrchestratorPlan,
  subtaskId: string,
  nextStatus: OrchestratorSubtaskStatus,
  now = Date.now(),
): OrchestratorSubtask {
  const subtask = plan.subtasks.find(item => item.id === subtaskId);
  if (!subtask) throw new Error(`Unknown orchestrator subtask: ${subtaskId}`);
  if (subtask.status === nextStatus) return subtask;
  if (nextStatus === 'running' && plan.approvalStatus !== 'approved') {
    throw new Error('Orchestrator plan requires approval before execution');
  }

  if (nextStatus === 'running') {
    const incomplete = subtask.dependsOn.filter(dependencyId => (
      plan.subtasks.find(item => item.id === dependencyId)?.status !== 'completed'
    ));
    if (incomplete.length > 0) {
      throw new Error(`Subtask ${subtaskId} is blocked by incomplete dependencies: ${incomplete.join(', ')}`);
    }
  }

  if (!isValidSubtaskTransition(subtask.status, nextStatus)) {
    throw new Error(`Invalid orchestrator subtask transition: ${subtask.status} -> ${nextStatus}`);
  }

  subtask.status = nextStatus;
  subtask.updatedAt = now;
  plan.updatedAt = now;
  plan.status = deriveOrchestratorPlanStatus(plan.subtasks);
  return subtask;
}

export function failOrchestratorSubtask(
  plan: OrchestratorPlan,
  subtaskId: string,
  error: string,
  now = Date.now(),
): OrchestratorSubtask {
  const subtask = transitionOrchestratorSubtask(plan, subtaskId, 'failed', now);
  subtask.error = error.trim() || 'Worker failed without a reported reason.';
  return subtask;
}

export function cancelOrchestratorSubtask(
  plan: OrchestratorPlan,
  subtaskId: string,
  now = Date.now(),
): OrchestratorSubtask {
  return transitionOrchestratorSubtask(plan, subtaskId, 'cancelled', now);
}

export function approveOrchestratorPlan(plan: OrchestratorPlan, now = Date.now()): void {
  if (plan.approvalStatus !== 'pending') {
    throw new Error(`Cannot approve orchestrator plan from ${plan.approvalStatus} state`);
  }
  plan.approvalStatus = 'approved';
  plan.updatedAt = now;
}

export function rejectOrchestratorPlan(plan: OrchestratorPlan, now = Date.now()): void {
  if (plan.approvalStatus !== 'pending') {
    throw new Error(`Cannot reject orchestrator plan from ${plan.approvalStatus} state`);
  }
  plan.approvalStatus = 'rejected';
  plan.updatedAt = now;
}

export function deriveOrchestratorPlanStatus(
  subtasks: readonly OrchestratorSubtask[],
): OrchestratorPlanStatus {
  if (subtasks.length === 0 || subtasks.every(item => item.status === 'completed')) return 'completed';
  if (subtasks.some(item => item.status === 'failed')) return 'failed';
  if (subtasks.every(item => item.status === 'completed' || item.status === 'cancelled')) return 'cancelled';
  if (subtasks.some(item => item.status === 'review')) return 'review';
  if (subtasks.some(item => item.status === 'running')) return 'running';
  return 'queued';
}

export function getNextRunnableOrchestratorSubtask(
  plan: OrchestratorPlan,
): OrchestratorSubtask | null {
  if (plan.approvalStatus !== 'approved' || (plan.executionPolicy.stopOnFailure && plan.subtasks.some(item => item.status === 'failed'))) return null;
  if (plan.subtasks.filter(item => item.status === 'running').length >= plan.executionPolicy.maxConcurrentWorkers) return null;
  return plan.subtasks.find(subtask => (
    subtask.status === 'queued'
    && subtask.dependsOn.every(dependencyId => (
      plan.subtasks.find(item => item.id === dependencyId)?.status === 'completed'
    ))
  )) ?? null;
}

export function isOrchestratorPlanTerminal(plan: OrchestratorPlan): boolean {
  return plan.subtasks.length > 0 && plan.subtasks.every(item => (
    item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled'
  ));
}

export function parseOrchestratorPlan(value: unknown): OrchestratorPlan | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== ORCHESTRATOR_PLAN_SCHEMA_VERSION
    || typeof raw.id !== 'string'
    || typeof raw.rootConversationId !== 'string'
    || typeof raw.goal !== 'string'
    || !isApprovalStatus(raw.approvalStatus)
    || !isExecutionPolicy(raw.executionPolicy)
    || !isPlanStatus(raw.status)
    || !isFiniteTimestamp(raw.createdAt)
    || !isFiniteTimestamp(raw.updatedAt)
    || !Array.isArray(raw.subtasks)
  ) return undefined;

  const subtasks: OrchestratorSubtask[] = [];
  for (const value of raw.subtasks) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const subtask = value as Record<string, unknown>;
    if (
      typeof subtask.id !== 'string'
      || typeof subtask.title !== 'string'
      || typeof subtask.description !== 'string'
      || !isSubtaskStatus(subtask.status)
      || !Array.isArray(subtask.dependsOn)
      || !subtask.dependsOn.every(item => typeof item === 'string')
      || !isFiniteTimestamp(subtask.createdAt)
      || !isFiniteTimestamp(subtask.updatedAt)
      || (subtask.conversationId !== undefined && typeof subtask.conversationId !== 'string')
      || (subtask.result !== undefined && typeof subtask.result !== 'string')
      || (subtask.error !== undefined && typeof subtask.error !== 'string')
    ) return undefined;
    subtasks.push({
      id: subtask.id,
      title: subtask.title,
      description: subtask.description,
      status: subtask.status,
      dependsOn: [...subtask.dependsOn],
      createdAt: subtask.createdAt,
      updatedAt: subtask.updatedAt,
      ...(typeof subtask.conversationId === 'string' ? { conversationId: subtask.conversationId } : {}),
      ...(typeof subtask.result === 'string' ? { result: subtask.result } : {}),
      ...(typeof subtask.error === 'string' ? { error: subtask.error } : {}),
    });
  }

  try {
    validatePlanInputs(subtasks);
  } catch {
    return undefined;
  }
  if (deriveOrchestratorPlanStatus(subtasks) !== raw.status) return undefined;
  return {
    schemaVersion: ORCHESTRATOR_PLAN_SCHEMA_VERSION,
    id: raw.id,
    rootConversationId: raw.rootConversationId,
    goal: raw.goal,
    approvalStatus: raw.approvalStatus,
    executionPolicy: raw.executionPolicy,
    status: raw.status,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    subtasks,
  };
}

function validatePlanInputs(subtasks: readonly OrchestratorSubtask[]): void {
  const ids = new Set<string>();
  for (const subtask of subtasks) {
    if (!subtask.id || ids.has(subtask.id)) {
      throw new Error(`Duplicate or empty orchestrator subtask id: ${subtask.id}`);
    }
    ids.add(subtask.id);
  }

  for (const subtask of subtasks) {
    for (const dependencyId of subtask.dependsOn) {
      if (!ids.has(dependencyId)) throw new Error(`Unknown subtask dependency: ${dependencyId}`);
      if (dependencyId === subtask.id) throw new Error('Orchestrator subtask dependencies must be acyclic');
    }
  }

  const dependencies = new Map(subtasks.map(subtask => [subtask.id, subtask.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Orchestrator subtask dependencies must be acyclic');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependencyId of dependencies.get(id) ?? []) visit(dependencyId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
}

function isValidSubtaskTransition(
  currentStatus: OrchestratorSubtaskStatus,
  nextStatus: OrchestratorSubtaskStatus,
): boolean {
  if (currentStatus === 'queued') return nextStatus === 'running' || nextStatus === 'failed' || nextStatus === 'cancelled';
  if (currentStatus === 'running') return nextStatus === 'review' || nextStatus === 'failed' || nextStatus === 'cancelled';
  if (currentStatus === 'review') return nextStatus === 'running' || nextStatus === 'completed' || nextStatus === 'failed' || nextStatus === 'cancelled';
  if (currentStatus === 'failed') return nextStatus === 'queued';
  return false;
}

function isSubtaskStatus(value: unknown): value is OrchestratorSubtaskStatus {
  return value === 'queued' || value === 'running' || value === 'review' || value === 'completed' || value === 'failed' || value === 'cancelled';
}

function isPlanStatus(value: unknown): value is OrchestratorPlanStatus {
  return value === 'queued' || value === 'running' || value === 'review' || value === 'completed' || value === 'failed' || value === 'cancelled';
}

function isApprovalStatus(value: unknown): value is OrchestratorApprovalStatus {
  return value === 'pending' || value === 'approved' || value === 'rejected';
}

function isExecutionPolicy(value: unknown): value is OrchestratorExecutionPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  return typeof policy.maxConcurrentWorkers === 'number'
    && Number.isInteger(policy.maxConcurrentWorkers)
    && policy.maxConcurrentWorkers >= 1
    && policy.maxConcurrentWorkers <= 10
    && typeof policy.stopOnFailure === 'boolean';
}

function normalizeExecutionPolicy(
  policy: Partial<OrchestratorExecutionPolicy> | undefined,
): OrchestratorExecutionPolicy {
  const maxConcurrentWorkers = policy?.maxConcurrentWorkers ?? 1;
  const stopOnFailure = policy?.stopOnFailure ?? true;
  if (!Number.isInteger(maxConcurrentWorkers) || maxConcurrentWorkers < 1 || maxConcurrentWorkers > 10) {
    throw new Error('maxConcurrentWorkers must be an integer between 1 and 10');
  }
  return { maxConcurrentWorkers, stopOnFailure };
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
