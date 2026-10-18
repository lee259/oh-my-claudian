import { runInNewContext } from 'node:vm';

import { filterActiveBranch } from '@/providers/claude/history/sdkBranchFilter';
import type { SDKNativeMessage } from '@/providers/claude/history/sdkHistoryTypes';

describe('filterActiveBranch', () => {
  // A Jest timeout cannot interrupt a synchronous infinite loop.
  function filterCyclicBranch(entries: SDKNativeMessage[], resumeAtMessageId?: string): SDKNativeMessage[] {
    return runInNewContext('filterActiveBranch(entries, resumeAtMessageId)', {
      filterActiveBranch, entries, resumeAtMessageId,
    }, { timeout: 1000 });
  }

  it.each([undefined, 'after', 'tail'])('retains history across a compaction cycle when resuming at %s', resumeAt => {
    // Issue #1672: the preserved segment descends from the boundary, whose
    // logical parent points forward to the tail of that same segment.
    const entries: SDKNativeMessage[] = [
      { type: 'system', subtype: 'compact_boundary', uuid: 'compact', parentUuid: null, logicalParentUuid: 'tail' },
      { type: 'user', uuid: 'summary', parentUuid: 'compact', isMeta: true },
      { type: 'assistant', uuid: 'head', parentUuid: 'summary' },
      { type: 'assistant', uuid: 'middle', parentUuid: 'head' },
      { type: 'assistant', uuid: 'last', parentUuid: 'middle' },
      { type: 'user', uuid: 'tool-result', parentUuid: 'last', toolUseResult: {} },
      { type: 'attachment', uuid: 'tail', parentUuid: 'tool-result' },
      { type: 'assistant', uuid: 'after', parentUuid: 'tail' },
    ];

    expect(filterCyclicBranch(entries, resumeAt).map(e => e.uuid)).toEqual([
      'compact', 'summary', 'head', 'middle', 'last', 'tool-result', 'tail',
      ...(resumeAt === 'tail' ? [] : ['after']),
    ]);
  });

  it.each([
    [undefined, ['loop', 'u-new', 'a-new']],
    ['a-old', ['loop', 'u-new', 'a-new']],
    ['u-new', ['loop', 'u-new']],
  ])('selects the latest branch through a self-parent cycle when resuming at %s', (resumeAt, expected) => {
    const entries: SDKNativeMessage[] = [
      { type: 'assistant', uuid: 'loop', parentUuid: 'loop' },
      { type: 'user', uuid: 'u-old', parentUuid: 'loop' },
      { type: 'assistant', uuid: 'a-old', parentUuid: 'u-old' },
      { type: 'user', uuid: 'u-new', parentUuid: 'loop' },
      { type: 'assistant', uuid: 'a-new', parentUuid: 'u-new' },
    ];

    expect(filterCyclicBranch(entries, resumeAt).map(e => e.uuid)).toEqual(expected);
  });

  it.each([undefined, 'one'])('handles a parent cycle with no leaf when resuming at %s', resumeAt => {
    const entries: SDKNativeMessage[] = [
      { type: 'assistant', uuid: 'one', parentUuid: 'two' },
      { type: 'assistant', uuid: 'two', parentUuid: 'one' },
    ];

    expect(filterCyclicBranch(entries, resumeAt)).toEqual(entries);
  });

  it('selects the latest branch through a cycle of non-conversation children', () => {
    const entries: SDKNativeMessage[] = [
      { type: 'system', uuid: 'one', parentUuid: 'two' },
      { type: 'attachment', uuid: 'two', parentUuid: 'one' },
      { type: 'user', uuid: 'u-old', parentUuid: 'one' },
      { type: 'assistant', uuid: 'a-old', parentUuid: 'u-old' },
      { type: 'user', uuid: 'u-new', parentUuid: 'one' },
      { type: 'assistant', uuid: 'a-new', parentUuid: 'u-new' },
    ];

    expect(filterCyclicBranch(entries).map(e => e.uuid)).toEqual(['one', 'two', 'u-new', 'a-new']);
  });

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
