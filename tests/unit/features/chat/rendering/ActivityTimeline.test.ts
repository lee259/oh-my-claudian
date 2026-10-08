import { projectMessageRun, projectTranscript } from '@/core/transcript/TranscriptProjection';
import type { ChatMessage, ContentBlock } from '@/core/types';
import { buildActivityTimeline } from '@/features/chat/rendering/ActivityTimeline';

function buildTimeline(
  blocks: ContentBlock[],
  options: Parameters<typeof buildActivityTimeline>[1] = {},
) {
  const toolCalls = blocks.flatMap((block) => {
    if (block.type !== 'tool_use') return [];
    return [{
      id: block.toolId,
      name: options.toolNames?.get(block.toolId) ?? 'Tool',
      input: {},
      status: 'completed' as const,
    }];
  });
  const message = {
    id: 'timeline-test-run',
    role: 'assistant',
    content: '',
    timestamp: 0,
    contentBlocks: blocks,
    toolCalls,
  } as ChatMessage;
  return buildActivityTimeline(projectMessageRun(
    message,
    'timeline-test-turn',
    options.live ? { activeMessageId: message.id } : {},
  ), options);
}

describe('buildActivityTimeline', () => {
  it('marks only the trailing activity phase active while the turn is live', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', toolId: 'read-1' },
      { type: 'text', content: 'Progress update.' },
      { type: 'tool_use', toolId: 'bash-1' },
    ];

    const timeline = buildTimeline(blocks, {
      live: true,
      toolNames: new Map([
        ['read-1', 'Read'],
        ['bash-1', 'Bash'],
      ]),
    });

    expect(timeline.items.map((item) => item.type)).toEqual(['activity', 'block', 'activity']);
    expect(timeline.items[0]).toMatchObject({ phases: [{ active: false }] });
    expect(timeline.items[2]).toMatchObject({ phases: [{ active: true }] });
  });

  it('keeps later narration and the next active phase in one live work fold', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', toolId: 'read-1' },
      { type: 'text', content: 'I found the relevant file.' },
      { type: 'tool_use', toolId: 'bash-1' },
    ];

    const timeline = buildTimeline(blocks, {
      live: true,
      toolNames: new Map([
        ['read-1', 'Read'],
        ['bash-1', 'Bash'],
      ]),
    });

    expect(timeline.items).toHaveLength(3);
    expect(timeline.fold).toEqual({ start: 0, end: 2 });
    expect(timeline.items[2]).toMatchObject({ type: 'activity', phases: [{ active: true }] });
  });

  it('stops extending a live fold before a pending interaction', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', toolId: 'read-1' },
      { type: 'text', content: 'I found the relevant file.' },
      { type: 'tool_use', toolId: 'bash-1' },
      { type: 'tool_use', toolId: 'pending-approval' },
      { type: 'tool_use', toolId: 'after-approval' },
    ];

    const timeline = buildTimeline(blocks, {
      live: true,
      pendingToolIds: new Set(['pending-approval']),
      toolNames: new Map([
        ['read-1', 'Read'],
        ['bash-1', 'Bash'],
        ['pending-approval', 'Write'],
        ['after-approval', 'Bash'],
      ]),
    });

    expect(timeline.items.map((item) => item.type)).toEqual([
      'activity', 'block', 'activity', 'block', 'activity',
    ]);
    expect(timeline.fold).toEqual({ start: 0, end: 2 });
  });

  it('keeps the final answer outside the live answered-work fold', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', toolId: 'read-1' },
      { type: 'text', content: 'The final answer is arriving.' },
    ];

    const timeline = buildTimeline(blocks, {
      live: true,
      toolNames: new Map([['read-1', 'Read']]),
    });

    expect(timeline.fold).toEqual({ start: 0, end: 0 });
    expect(timeline.items[timeline.fold?.end ?? 0]).toMatchObject({ type: 'activity' });
    expect(timeline.items.at(-1)).toMatchObject({ type: 'block', blockIndex: 1 });
  });

  it('ignores empty thinking blocks instead of creating placeholder activity rows', () => {
    const blocks: ContentBlock[] = [
      { type: 'thinking', content: '' },
      { type: 'thinking', content: '   ' },
      { type: 'text', content: 'The answer.' },
    ];

    expect(buildTimeline(blocks).items).toEqual([
      { type: 'block', blockIndex: 2, foldable: true, boundaryBefore: false },
    ]);
  });

  it('hides leading reasoning once assistant prose arrives before any tool call', () => {
    const blocks: ContentBlock[] = [
      { type: 'thinking', content: 'First private thought.' },
      { type: 'thinking', content: 'Second private thought.' },
      { type: 'text', content: 'I will inspect the vault.' },
      { type: 'thinking', content: 'The first tool is needed.' },
      { type: 'tool_use', toolId: 'read-1' },
      { type: 'text', content: 'The answer.' },
    ];

    const timeline = buildTimeline(blocks, {
      toolNames: new Map([['read-1', 'Read']]),
    });

    expect(timeline.items).toMatchObject([
      { type: 'block', blockIndex: 2, foldable: true, boundaryBefore: false },
      {
        type: 'activity',
        phases: [{ kind: 'research', stepIndexes: [3, 4] }],
        boundaryBefore: false,
      },
      { type: 'block', blockIndex: 5, foldable: true, boundaryBefore: false },
    ]);
  });

  it('groups a thinking summary with the work it precedes', () => {
    const blocks: ContentBlock[] = [
      { type: 'thinking', content: 'Need inspect the file.' },
      { type: 'tool_use', toolId: 'read-1' },
      { type: 'text', content: 'The answer.' },
    ];

    const timeline = buildTimeline(blocks, {
      toolNames: new Map([['read-1', 'Read']]),
    });

    expect(timeline.items).toMatchObject([
      { type: 'activity', phases: [{ kind: 'research', stepIndexes: [0, 1] }] },
      { type: 'block', blockIndex: 2, foldable: true },
    ]);
    expect(timeline.fold).toEqual({ start: 0, end: 0 });
  });

  it('groups prose, activity, and prose into ordered turn items', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', content: 'I will inspect the repository.' },
      { type: 'thinking', content: 'Need inspect files.' },
      { type: 'tool_use', toolId: 'read-1' },
      { type: 'text', content: 'I found the relevant implementation.' },
      { type: 'tool_use', toolId: 'grep-1' },
      { type: 'text', content: 'Here is the result.' },
    ];

    const timeline = buildTimeline(blocks, {
      toolNames: new Map([
        ['read-1', 'Read'],
        ['grep-1', 'Grep'],
      ]),
    });

    expect(timeline.items).toMatchObject([
      { type: 'block', blockIndex: 0, foldable: true, boundaryBefore: false },
      {
        type: 'activity',
        phases: [{ kind: 'research', stepIndexes: [1, 2] }],
        boundaryBefore: false,
      },
      { type: 'block', blockIndex: 3, foldable: true, boundaryBefore: false },
      {
        type: 'activity',
        phases: [{ kind: 'research', stepIndexes: [4] }],
        boundaryBefore: false,
      },
      { type: 'block', blockIndex: 5, foldable: true, boundaryBefore: false },
    ]);
    expect(timeline.fold).toEqual({ start: 0, end: 3 });
  });

  it('assigns an explicit semantic kind to a phase using its tool steps', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', toolId: 'edit-1' },
      { type: 'tool_use', toolId: 'bash-1' },
      { type: 'text', content: 'The answer.' },
    ];

    expect(buildTimeline(blocks, {
      toolNames: new Map([
        ['edit-1', 'Edit'],
        ['bash-1', 'Bash'],
      ]),
    }).items[0]).toMatchObject({
      type: 'activity',
      phases: [{ kind: 'edit', stepIndexes: [0, 1] }],
      boundaryBefore: false,
    });
  });

  it('derives phase identity from the projected run and its stable blocks', () => {
    const timeline = buildTimeline([
      { type: 'tool_use', toolId: 'stable-read', id: 'provider-block-42' },
      { type: 'text', content: 'Done.' },
    ]);

    expect(timeline.items[0]).toMatchObject({
      type: 'activity',
      phases: [{
        id: 'provider-block-42',
        turnId: 'timeline-test-turn',
        runId: 'timeline-test-run',
      }],
    });
  });

  it('groups ordered assistant-run blocks into one turn activity timeline', () => {
    const messages: ChatMessage[] = [
      { id: 'timeline-user', role: 'user', content: 'Inspect the project.', timestamp: 1 },
      {
        id: 'timeline-run-1', role: 'assistant', content: 'Checking files.', timestamp: 2,
        contentBlocks: [{ type: 'tool_use', toolId: 'timeline-read' }],
        toolCalls: [{ id: 'timeline-read', name: 'Read', input: {}, status: 'completed' }],
      },
      {
        id: 'timeline-run-2', role: 'assistant', content: 'The answer.', timestamp: 3,
        contentBlocks: [
          { type: 'tool_use', toolId: 'timeline-grep' },
          { type: 'text', content: 'The answer.' },
        ],
        toolCalls: [{ id: 'timeline-grep', name: 'Grep', input: {}, status: 'completed' }],
      },
    ];

    const timeline = buildActivityTimeline(projectTranscript(messages)[0], {
      toolNames: new Map([
        ['timeline-read', 'Read'],
        ['timeline-grep', 'Grep'],
      ]),
    });

    expect(timeline.items[0]).toMatchObject({
      type: 'activity',
      phases: [{ stepIndexes: [0, 1], runId: 'timeline-run-1', turnId: 'timeline-user' }],
    });
    expect(timeline.fold).toEqual({ start: 0, end: 0 });
  });

  it('leaves the final answer outside the answered work fold', () => {
    const blocks: ContentBlock[] = [
      { type: 'thinking', content: 'Check the files.' },
      { type: 'tool_use', toolId: 'read-1' },
      { type: 'text', content: 'The final answer.' },
    ];

    const timeline = buildTimeline(blocks, { toolNames: new Map([['read-1', 'Read']]) });

    expect(timeline.fold).toEqual({ start: 0, end: 0 });
    expect(timeline.items[timeline.fold?.end ?? 0]).toMatchObject({
      type: 'activity',
      phases: [{ kind: 'research', stepIndexes: [0, 1] }],
    });
  });

  it('does not fold later work into the answer to earlier work', () => {
    const blocks: ContentBlock[] = [
      { type: 'thinking', content: 'Inspect the file.' },
      { type: 'tool_use', toolId: 'read-1' },
      { type: 'text', content: 'The file is valid.' },
      { type: 'tool_use', toolId: 'follow-up-1' },
    ];

    expect(buildTimeline(blocks, {
      toolNames: new Map([['read-1', 'Read']]),
    }).fold).toEqual({ start: 0, end: 0 });
  });

  it('stops the work fold before background work resumed after a yielded reply', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', toolId: 'read-before-yield' },
      { type: 'text', content: 'The background check is running.' },
      { type: 'tool_use', toolId: 'background-check' },
      { type: 'text', content: 'The background check is complete.' },
    ];

    const timeline = buildTimeline(blocks, {
      backgroundToolIds: new Set(['background-check']),
      toolNames: new Map([
        ['read-before-yield', 'Read'],
        ['background-check', 'Bash'],
      ]),
    });

    expect(timeline.fold).toEqual({ start: 0, end: 0 });
    expect(timeline.items[timeline.fold?.end ?? 0]).toMatchObject({
      type: 'activity',
      phases: [{ stepIndexes: [0] }],
    });
  });

  it('does not create an answered work fold before the assistant responds', () => {
    const blocks: ContentBlock[] = [
      { type: 'thinking', content: 'Inspect the file.' },
      { type: 'tool_use', toolId: 'read-1' },
    ];

    expect(buildTimeline(blocks).fold).toBeUndefined();
  });

  it('keeps standalone transcript items outside the activity fold', () => {
    const blocks: ContentBlock[] = [
      { type: 'thinking', content: 'Earlier work.' },
      { type: 'citations', citations: { kind: 'memory', entries: [] } },
      { type: 'tool_use', toolId: 'read-1' },
      { type: 'text', content: 'The answer.' },
    ];

    const timeline = buildTimeline(blocks, { toolNames: new Map([['read-1', 'Read']]) });
    expect(timeline.items.map((item) => item.type)).toEqual(['activity', 'block', 'activity', 'block']);
    expect(timeline.fold).toEqual({ start: 2, end: 2 });
  });

  it('keeps pending tool interactions as standalone fold boundaries', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', toolId: 'read-1' },
      { type: 'tool_use', toolId: 'approval-1' },
      { type: 'tool_use', toolId: 'read-2' },
      { type: 'text', content: 'The answer.' },
    ];

    const timeline = buildTimeline(blocks, {
      pendingToolIds: new Set(['approval-1']),
      toolNames: new Map([['read-2', 'Read']]),
    });
    expect(timeline.items.map((item) => item.type)).toEqual(['activity', 'block', 'activity', 'block']);
    expect(timeline.fold).toEqual({ start: 2, end: 2 });
  });

  it('does not fold across standalone interactions outside the content blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', toolId: 'read-1' },
      { type: 'tool_use', toolId: 'read-2' },
      { type: 'text', content: 'The answer.' },
    ];

    const timeline = buildTimeline(blocks, {
      boundaryBeforeIndexes: new Set([1]),
      toolNames: new Map([
        ['read-1', 'Read'],
        ['read-2', 'Read'],
      ]),
    });
    expect(timeline.items.map((item) => item.type)).toEqual(['activity', 'activity', 'block']);
    expect(timeline.fold).toEqual({ start: 1, end: 1 });
  });

  it('keeps failed subagents as their own transcript item', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', toolId: 'read-1' },
      { type: 'subagent', subagentId: 'agent-1' },
      { type: 'text', content: 'The answer.' },
    ];

    const timeline = buildTimeline(blocks, {
      failedSubagentIds: new Set(['agent-1']),
      toolNames: new Map([['read-1', 'Read']]),
    });
    expect(timeline.items.map((item) => item.type)).toEqual(['activity', 'subagents', 'block']);
    expect(timeline.fold).toEqual({ start: 0, end: 1 });
  });
});
