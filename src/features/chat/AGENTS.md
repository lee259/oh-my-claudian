# Chat Feature

`src/features/chat/` owns the main sidebar chat interface. It assembles tabs, controllers, renderers, and provider-backed services around provider-neutral execution contracts.

## Boundaries

- Controllers request conversation and execution changes through injected callbacks, `FeatureHost`, and `ChatExecutionCoordinator`.
- Renderers and UI components render state and emit user intent. They must not mutate tab membership, conversation persistence, or provider-session lifecycle directly.
- `InputController` builds canonical execution requests; providers own native prompt encoding.
- Resolve provider-owned services through `ProviderRegistry` and `ProviderWorkspaceRegistry`; do not import concrete provider implementations.

## Composition

- `TabRuntimeFactory` creates the provider-neutral runtime shell before controllers and execution resources are attached.
- `TabControllerFactory`, `TabStreamControllerFactory`, `TabConversationControllerFactory`, `TabInputControllerFactory`, and `TabNavigationControllerFactory` assemble tab-owned controllers at their respective boundaries.
- `ClaudianView` owns view assembly, DOM placement, presentation coordination, layout navigation, and the persisted current-tab snapshot.
- `TabBar` owns expanded-title presentation state for the current view.

Detailed tab membership, tab lifecycle, and snapshot rules live in `tabs/AGENTS.md`. Execution leases, warm owners, and cleanup ordering live in `execution/AGENTS.md`.

## Feature Rules

- The chat view uses one panel. New Conversation and `/clear` replace the active tab's conversation.
- Bang-bash mode bypasses provider execution and runs a local shell command only when the enabled provider exposes it through `ProviderChatUIConfig`.
- Forking is provider-owned under the hood. Use execution and provider history contracts instead of reconstructing provider session IDs in feature code.
- `ClaudianView.onClose()` must abort active tabs, flush the current tab state, and dispose tab-owned execution coordinators.
