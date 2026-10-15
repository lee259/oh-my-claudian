import { filterActiveBranch } from '@/providers/claude/history/sdkBranchFilter';
import type { SDKNativeMessage } from '@/providers/claude/history/sdkHistoryTypes';

describe('filterActiveBranch', () => {
  it('keeps pre-compaction history when resuming after a compact boundary', () => {
    const entries: Array<SDKNativeMessage & { logicalParentUuid?: string | null }> = [
      { type: 'user', uuid: 'user-before-compact', parentUuid: null },
      { type: 'assistant', uuid: 'assistant-before-compact', parentUuid: 'user-before-compact' },
      {
        type: 'system',
        subtype: 'compact_boundary',
        uuid: 'compact-boundary',
        parentUuid: null,
        logicalParentUuid: 'assistant-before-compact',
      },
      { type: 'user', uuid: 'user-after-compact', parentUuid: 'compact-boundary' },
      { type: 'assistant', uuid: 'assistant-after-compact', parentUuid: 'user-after-compact' },
    ];

    const result = filterActiveBranch(entries, 'assistant-after-compact');

    expect(result.map(entry => entry.uuid)).toEqual([
      'user-before-compact',
      'assistant-before-compact',
      'compact-boundary',
      'user-after-compact',
      'assistant-after-compact',
    ]);
  });
});
