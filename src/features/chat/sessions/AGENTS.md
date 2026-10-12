# Conversation Runtime Ownership

- ConversationRuntime owns the provider-neutral coordinator, active-turn and background-work lifetime, ChatState projection and runtime-specific selections. Presentation must not become execution authority.
- ConversationRuntimeRegistry reserves a conversation synchronously before asynchronous creation. One conversation has one runtime and at most one presentation attachment; old attachment handles cannot detach a replacement.
- Registry shutdown fences new admission synchronously, drains reservations and disposes all owned runtimes before provider infrastructure is released.
- Keep WarmExecutionPool as the separate resource-capacity/LRU policy. Do not infer transcript eviction or native replay completeness from cooling or a provider's native-history capability.
- The registry is a tested foundation and is not wired into application lifecycle. The current migration has not enabled close-to-detach. Do not change close behavior before status/Stop, deletion/archive, resource invalidation, persistence and unload have been routed through runtime ownership and tested.
