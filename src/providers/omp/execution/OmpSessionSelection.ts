import { isOmpRoleSelector } from '../models';

export interface OmpSessionSelection {
  model: string;
  reasoning: string | null;
}

/** Selection intent is independent from OMP's current, autonomously chosen model. */
export function readOmpSessionSelection(state?: Readonly<Record<string, unknown>>): OmpSessionSelection | null {
  const value = state?.ompSelection;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.model !== 'string' || !record.model.trim()) return null;
  if (record.reasoning !== null && typeof record.reasoning !== 'string') return null;
  return { model: record.model, reasoning: record.reasoning };
}

export function getOmpRoleSelector(model: string | null): string | undefined {
  return model && isOmpRoleSelector(model) ? model : undefined;
}
