# Chat Tabs

`src/features/chat/tabs/` owns runtime tab membership, tab identity, tab navigation, and tab-scoped assembly. It must not become a second conversation repository or provider runtime.

## Ownership

- `TabManager` owns runtime-tab membership, active-tab selection, and create/switch/close operations across tabs.
- `TabSession` owns per-tab identity, conversation and provider binding, lifecycle value, coordinator attachment, active-turn reference, and background-work sequencing.
- `ChatState` owns transient per-tab message projection, stream state, queued input, render state, and conversation-operation flags.
- `TabRuntimeFactory` allocates the provider-neutral runtime shell and initial draft/provider resolution. It must not create provider execution sessions.
- `TabStatePersistenceCoordinator` owns write sequencing for the active tab snapshot, not semantic tab state. It must not infer, add, or remove runtime tabs.
- Model selection is coordinated by `TabModelSelectionCoordinator` per tab and by the app-owned coordinator for the future-tab seed.

## Lifecycle and State

Valid tab lifecycle values are `provisional`, `cold`, `warm`, and `closing`.

- History previews may be provisional and are discarded when navigation is superseded unless explicitly retained.
- Retained or restored tabs without execution resources are cold, including unbound drafts.
- Acquiring provider execution resources makes a retained tab warm; cooling returns it to cold without closing the tab or conversation.
- Closing prevents new hydration work, saves when required, disposes execution resources, and removes the tab from `TabManager`. It never deletes the conversation.
- Hydration state is orthogonal to tab lifecycle and provider execution state.
- The configured `maxWarmAgentProcesses` limit applies only to warm execution owners and remains within the supported 5-10 range; runtime tab creation is not capped by it.

Keep durable conversation state, the persisted active-tab shell, runtime tab state, and provider execution state independent. Layout and presentation changes must not alter conversation binding or execution lifecycle.

## Navigation Rules

- Conversation navigation is latest-wins across provisional and retained targets.
- Manager teardown fences later requests.
- Switching the active tab must not cancel, dispose, or transfer another tab's active execution.
- Command-only warmup stays isolated from real conversation sessions; the reserved execution warmup mode is currently a no-op.
- The latest successful explicit model-picker selection wins for the future-tab seed. Restoration, hydration, fallback, fork inheritance, and auxiliary executions must not update that seed.
