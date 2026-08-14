# dsh Provider

`src/providers/dsh/` adapts DeepSeek Harness through its ACP stdio server.

- dsh ACP is developer-preview infrastructure; keep its launch command and arguments configurable.
- The ACP server currently exposes fresh sessions and committed assistant text only. Do not claim native history, plans, usage, or rich tool streaming that dsh does not send.
- `{model}` in configured launch arguments is replaced by the selected dsh model; provider-owned launch policy stays in this directory.
- Reuse `src/providers/acp/` for transport, permission normalization, and session updates.

