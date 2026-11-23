import type { ApprovalDecision } from '../../../core/types';

/** The approval answer for one selected option; exact providers receive the option's native value. */
export function resolveApprovalSelection(
  selectedValue: string,
  optionDecisions: ReadonlyMap<string, ApprovalDecision>,
  exactOptionSelection: boolean,
): ApprovalDecision {
  return exactOptionSelection
    ? { type: 'select-option', value: selectedValue }
    : optionDecisions.get(selectedValue) ?? { type: 'select-option', value: selectedValue };
}
