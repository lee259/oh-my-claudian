# Cursor Provider

`src/providers/cursor/` adapts Cursor Agent through `agent acp` over stdio.

## Ownership

- Cursor launch, authentication expectations, modes, model discovery, extension requests, and provider state remain in this directory.
- Reuse `src/providers/acp/` for protocol transport, standard session updates, permissions, and event normalization.
- Cursor sessions resume through ACP `session/load`; read-only transcript replay is loaded from Cursor's local ACP SQLite store. Native session enumeration is not supported until Cursor exposes a stable list/history interface.
- `supportsNativeHistory` remains false: Cursor itself has local history and CLI resume commands, but ACP does not expose a stable session-list interface. Local transcript hydration restores persisted Claudian records without claiming to provide Cursor's native session list or resume UI.

## Protocol Rules

- Pre-authenticate with `agent login` or Cursor-owned environment variables; Claudian must not store Cursor credentials.
- Standard ACP permission requests use `AcpInteractionController`.
- Blocking `cursor/ask_question` and `cursor/create_plan` requests must be answered through `CursorExtensionInteractionRouter`; leaving either request unanswered blocks the turn.
- Cursor notification extensions are optional presentation enhancements. Do not promote them into core contracts unless another provider needs the same semantic interface.

## Capabilities

- Agent, Ask, and Plan map to ACP session modes `agent`, `ask`, and `plan`.
- Models come from the ACP session model state and only explicitly selected models appear in chat.
- MCP remains Cursor-owned through `.cursor/mcp.json`; Claudian does not duplicate its configuration.
- Runtime `/` commands come from ACP `available_commands_update` on a short-lived metadata session. Cursor advertises them ~4s after `session/new` (~12s with startup), so the catalog uses a provider-owned discovery deadline and tabs warm commands on creation.
- Cursor has no session-directory override or `session/close`; metadata probes (model and command discovery) must remove their prompt-less `~/.cursor/acp-sessions/<id>` folder, and only when it contains nothing but `meta.json`.
- Cursor runs a slash command only when the prompt is the bare command; prompts starting with a slash command must be sent without appended note, selection, or file context.
- Fork, rewind, native history hydration, and turn steering are intentionally unsupported.
