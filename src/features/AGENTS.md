# Feature Layer

`src/features/` owns user-facing orchestration and presentation. Features depend on `FeatureHost`, provider-neutral core contracts, and shared UI primitives; they do not import concrete provider implementations.

## Boundaries

- Features own user intent, presentation state, and workflow coordination. Provider-native processes, sessions, transcripts, and storage formats remain provider-owned.
- Resolve provider behavior through `ProviderRegistry`, `ProviderWorkspaceRegistry`, capabilities, and typed host contracts.
- Controllers and renderers request application or provider changes through injected boundaries. They must not reach through `ClaudianPlugin` or mutate application repositories directly.
- Live streaming should use provider runtime events; history replay should use provider-owned read-only transcript services.

## State and Verification

- Keep durable conversation state, persisted feature snapshots, runtime UI state, and provider execution state separate.
- A feature change that crosses a provider boundary must test the provider-neutral contract first, then cover provider-specific behavior at the owning adapter.
- When a feature cannot be tested directly, test the closest stable public interface and record the boundary in the scoped guide or test.
