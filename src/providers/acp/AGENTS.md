# Shared ACP Infrastructure

`src/providers/acp/` contains provider-neutral Agent Client Protocol transport, interaction, session, update normalization, and tool-result primitives.

## Ownership

- Keep JSON-RPC transport, subprocess mechanics, permission routing, session updates, and common event normalization here.
- Do not add provider launch policy, authentication policy, model catalogs, provider-specific extensions, native history, or provider-state interpretation here.
- Do not create a generic ACP runtime superclass. Concrete providers own their lifecycle and policy while reusing these primitives.
- Normalize only semantics guaranteed by ACP. Preserve unknown provider data and keep provider-specific tool or notification mapping in the owning provider.

## Lifecycle

- ACP sessions and interactions must release transports, pending requests, and interaction waiters during disposal.
- A disposed transport or session must not accept new requests or publish late events into a replacement provider session.
- Test transport, interaction, normalization, cancellation, and disposal contracts here; test provider extensions in the provider directory.
