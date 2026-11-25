export const ANTIGRAVITY_PERMISSION_MODES = ['normal', 'acceptEdits', 'auto', 'yolo'] as const;

export type AntigravityPermissionMode = typeof ANTIGRAVITY_PERMISSION_MODES[number];

export function isAntigravityPermissionMode(value: string): value is AntigravityPermissionMode {
  return ANTIGRAVITY_PERMISSION_MODES.includes(value as AntigravityPermissionMode);
}

/**
 * agy's native `mode` option for a Claudian permission mode. Native `plan` is never selected.
 * YOLO runs native `default`, and Claudian approves every request agy relays, subagents' included.
 */
export function resolveAntigravityNativeMode(permissionMode: string | undefined): 'accept-edits' | 'auto' | 'default' {
  if (permissionMode === 'auto') return 'auto';
  return permissionMode === 'acceptEdits' ? 'accept-edits' : 'default';
}

export function shouldAutoApproveAntigravityPermission(permissionMode: string | undefined): boolean {
  return permissionMode === 'yolo';
}
