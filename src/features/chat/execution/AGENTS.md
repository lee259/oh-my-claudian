# Chat Execution

`src/features/chat/execution/` owns the provider-neutral execution orchestration for chat tabs. It coordinates core lifecycle leases and provider sessions but does not interpret provider-native protocol or state.

## Ownership

- `ChatExecutionCoordinator` owns one tab's provider-session binding, active execution, interaction fencing, cancellation, and disposal.
- `WarmExecutionPool` owns application-scoped warm execution owners, the configured concurrent-running-session limit, and least-recently-used cooling of idle owners.
- Core `ProviderExecutionLifecycleRegistry` owns provider generations, transition fencing, and live session leases. It is independent from the feature-owned warm pool and tab state.
- `TabRuntimeCleanup` must release tab-owned resources in reverse order after conversation save and execution drain, before tab DOM removal.

## Lifecycle Rules

- A stale provider generation, session binding, stream generation, or disposal generation must not update the current tab.
- Warm preparation must revalidate conversation binding and disposal generation after acquisition and snapshot persistence. Superseded work must not install, retain, or publish a warm session.
- Cooling may release an idle execution owner, but must preserve the runtime tab, conversation binding, hydrated UI state, and resumable provider snapshot.
- Active executions and unresolved interactions are protected from cooling.
- Runtime factories allocate provider-neutral shells. Execution sessions and feature controllers are attached by the owning initialization flow.

## Testing

Test lifecycle fencing, cancellation, disposal, warm/cold transitions, and stale-result rejection through `ChatExecutionCoordinator`, `WarmExecutionPool`, or the core lifecycle contract. Do not expose private methods only to make a lifecycle test possible.
