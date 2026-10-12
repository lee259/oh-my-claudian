# Conversation Runtime Ownership

- ConversationRuntime owns the provider-neutral coordinator, active-turn and background-work lifetime, ChatState projection and runtime-specific selections. Presentation must not become execution authority.
- ConversationRuntimeRegistry reserves a conversation synchronously before asynchronous creation. One conversation has one runtime and at most one presentation attachment; old attachment handles cannot detach a replacement.
- Registry shutdown fences new admission synchronously, drains reservations and disposes all owned runtimes before provider infrastructure is released.
- Keep WarmExecutionPool as the separate resource-capacity/LRU policy. Do not infer transcript eviction or native replay completeness from cooling or a provider's native-history capability.
- Registration release belongs to runtime retirement, not presentation detach. Ordinary tab/view close retains the model, coordinator and pending interactions; reopening attaches the same runtime. History status/Stop, deletion, archive eligibility and unload query the registry. Skill resource generations and provider lifecycle transitions remain application-scoped even with no open views.
- Detached composer text, images, quotes and file-context flags survive reattachment. Permission choices are retained per runtime through the provider UI configuration's own resolve/apply hooks; do not store a synthetic shared mode in place of a native selection.
- Initial hydration is runtime-owned and drains on unload. Reattachment of a ready runtime never performs native-history hydration. Pending new-session plan continuation waits for a presentation rather than rebinding a detached conversation.

- Runtime controller factories must read DOM, selectors and view actions through the current presentation. Use structural selection readers and nullable surfaces; do not capture the original DOM/UI object or view in a retained controller. Conversation transcript listeners attach with an exact release handle.
