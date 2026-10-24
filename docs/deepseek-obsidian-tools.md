# DeepSeek Obsidian tools

Claudian's DeepSeek chat presets register `obsidian_vault` through the native `tools` service. Its operations are `backlinks`, `set-property`, `move`, and `trash`. The existing Obsidian workspace adapter owns path validation, frontmatter updates, link-aware moves, and trash behavior.

Each execution session owns a bridge credential. Before admitting a prompt, it publishes that credential for its exclusively claimed native session. The native tool resolves the calling agent's exact session ID; unrelated sessions and subagents do not inherit credentials. Passive and read-only auxiliary presets omit the plugin entirely.

Credentials are written atomically to mode-0600 files under a mode-0700 launch directory, using hashed session IDs. They never enter plugin source, prompts, native history, or user profiles. Binding failure or release revokes the bridge token, lease release removes the session file, and Host disposal removes the launch directory. The session retains authorization between requested turns so native background work can continue under the same policy. Native MCP settings and permissions remain provider-owned.

The adapter uses the native tool registration contract, JSON Schema, Node built-ins, and loopback MCP HTTP. Requests propagate cancellation and have a 30-second deadline. Bridge errors become native tool errors.

## Future npm extraction

This change integrates the tool inside Claudian only. It does not publish a package or provide an independent Obsidian CLI backend.

`DeepSeekObsidianTools.ts` contains the native plugin source; it imports only the shared tool description and schema at build time. The generated module has no Claudian or Obsidian runtime imports. This is the extraction boundary for a future npm package: the package would own registration and transport, while Claudian would continue to own credential issuance, authorization, and cleanup. Standalone use still needs a separate backend and explicit vault targeting. The private connection-file protocol is not a stable public package API.

## Validation

The integration tests execute the generated native module against the real loopback bridge and verify denied sessions, operation policy, and revoked bindings. Backend tests verify that admission authorizes only the claimed session and disposal revokes its token. Native runtime qualification uses an isolated DSH_HOME and a deterministic local model adapter, without external model calls or user history changes.
