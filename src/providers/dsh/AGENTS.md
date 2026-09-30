# DeepSeek Harness provider

- This provider uses the official `dsh --profile acp` stdio server; it owns launch policy, model catalog normalization, and DSH session behavior.
- Keep user setup aligned with the built-in DSH CLI lifecycle. Do not require a separately configured ACP executable or manually authored launch arguments.
- Persistent conversation resume is only valid when the runtime advertises and implements ACP list, resume, and close. Never silently replace a failed resume with a fresh session.
- Runtime conversation disposal must leave its native DSH session resumable; `session/close` is reserved for temporary sessions such as model discovery.
- ACP resume restores the native log but does not replay it. Persist Claudian's rendered transcript in DSH-owned provider state and hydrate it when metadata has no messages.
- DSH `usage_update` reports current context occupancy with an authoritative window size. Do not emit a zero estimate at turn start; allow lower snapshots after compaction.
- DSH reports image support from the route at ACP initialization. Catalog discovery must not override the user's ACP profile; runtime sessions may patch only the model selected in Claudian so initialization and the first request use the same route. Never force one hard-coded route or claim image support when the selected route cannot accept it.
- Model discovery currently obtains config options from an ACP session. Avoid sending a prompt during discovery and reuse its persisted session id so repeated refreshes do not leave an unbounded set of empty sessions.
- DSH remains a preview runtime. Keep unsupported provider capabilities disabled until their behavior is implemented and covered at this provider boundary.
