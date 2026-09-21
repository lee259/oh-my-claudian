# Provider Layer

`src/providers/` owns concrete provider adapters behind provider-neutral core and host contracts. Provider behavior is not assumed to be at parity; each provider guide is the source of its deliberate differences.

## Boundaries

- Provider runtime and protocol code may depend on `ProviderHost`, core contracts, and shared provider/UI primitives. It must not import chat views, feature controllers, or feature orchestration.
- Provider-owned session fields, native protocol, process lifecycle, transcripts, history, settings, and `providerState` stay behind typed helpers in the owning provider directory.
- Provider implementations must expose behavior through registration, capabilities, workspace services, UI configuration, history, and settings reconciliation rather than shared provider switches.
- Provider settings input is untrusted runtime data. Decode every field and fail closed for invalid permission, tool, sandbox, or model modes.

## Runtime and Storage

- Prefer provider-native behavior at the adapter boundary instead of reimplementing it in features.
- Live output comes from the provider runtime protocol when available. Native history and transcripts are read-only replay sources; Claudian must not mutate or delete them.
- Runtime-discovered commands are read-only in Claudian; providers own editing and deletion.
- Auxiliary query runners own their own process and session, independent from chat runtime sessions.
- When provider behavior is uncertain, inspect sanitized runtime output first. Put captures and throwaway scripts in `.context/`.

## ACP Boundary

- ACP providers may share transport, interaction, session, and normalization primitives from `src/providers/acp/`.
- Launch policy, extensions, model discovery, tool normalization, history, and provider state remain in the concrete provider directory.
- Do not infer Cursor, Grok, OMP, or OpenCode behavior from another ACP provider.

## Verification

For a new or changed provider behavior, inspect its `capabilities.ts`, registration, UI config, settings storage/reconciliation, workspace services, history, and nearest provider guide. Test provider-neutral contracts first, then the adapter's distinct behavior.
