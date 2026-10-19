# OMP Provider

`src/providers/omp/` adapts Oh My Pi through the OMP ACP subprocess and OMP-owned CLI metadata commands.

## Ownership

- OMP launch policy, environment isolation, ACP sessions, model discovery, tool normalization, history, settings, and provider state remain in this directory.
- Reuse `src/providers/acp/` for transport, permissions, session updates, and event normalization; do not assume ACP providers expose the same model or tool semantics.
- Concrete model discovery uses `omp models --json`; configured chat roles come from `omp config get modelRoles --json`. Keep explicit enablement for both. ACP config options provide session thinking levels, not a substitute for the full catalog.
- Persist roles as `omp:@role`, preserving case. Launch the real ACP process with `--model @role`; OMP owns prewalk, fallback, auxiliary roles, and native thinking. Do not reapply role models or unchanged reasoning on ordinary turns: ACP setters count as explicit choices and release native handoffs. Persist selection intent separately from OMP's actual model so resume respects the model restored by OMP, including its ephemeral-switch policy.
- ACP model setters accept concrete IDs only. For an explicit role change on an existing transcript, resolve it once through an isolated metadata process with the same launch settings, then configure the resumed session. Never prompt that resolver. Follow `config_option_update` for actual-model projection; it must not overwrite the selected role.

## Isolation Rules

- OMP must not inherit `PI_*` environment variables or Pi data/configuration directories. Keep the filtering in `OmpLaunchSpec` and apply it to both runtime and metadata subprocesses.
- On POSIX hosts, OMP ACP and metadata subprocesses resolve the user's login-shell environment so GUI-launched Obsidian can use the same CLI credentials as a terminal. Explicit Claudian environment settings override shell values; never log resolved environment values.
- OMP model selections use the `omp:` namespace. Never route an OMP model through Pi's `pi:` namespace or infer provider ownership from an unscoped raw model ID.
- OMP settings writers must merge provider-owned fields and normalize persisted catalog, thinking, environment, and CLI-path values before use.

## Protocol and Presentation

- Live output comes from ACP notifications and is normalized through the shared ACP execution normalizer plus OMP's tool presentation adapter.
- OMP ACP titles such as `Reading ... for context` must be mapped to shared tool names before reaching feature renderers; keep provider-specific mappings here.
- Model discovery runs in an independent metadata subprocess. It must not reuse a conversation session or mutate provider-native history.
- Metadata subprocesses (model and command discovery) must set `isolateNativeSessions`; `omp acp` ignores `--no-session` and otherwise writes an empty session into the user's OMP history for every probe.
- Runtime `/` commands come from ACP `available_commands_update` on an isolated metadata session; OMP advertises skills as `skill:<name>` commands.
- OMP parses all text after a slash command as its argument, so prompts that start with a slash command must be sent without appended note, selection, or file context.
- `OMP_HIDDEN_RUNTIME_COMMANDS` hides advertised builtins that conflict with Claudian controls (per-turn model/reasoning, native session identity, terminal or dashboard surfaces, directory built-ins); skills are never hidden by default. Users can hide more through the provider settings.

## Verification

- Test model JSON parsing, `omp:` model namespacing, Pi environment filtering, ACP tool-name normalization, and thinking-option projection at their provider-owned seams.
- When OMP behavior is uncertain, inspect real `omp models --json` or ACP output first and keep captures or throwaway probes under `.context/`.
