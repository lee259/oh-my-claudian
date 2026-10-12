# Conversation Runtime Ownership

- ConversationRuntime owns the provider-neutral coordinator, active-turn and background-work lifetime, ChatState projection and runtime-specific selections. Presentation must not become execution authority.
- ConversationRuntimeRegistry reserves a conversation synchronously before asynchronous creation. One conversation has one runtime and at most one presentation attachment; old attachment handles cannot detach a replacement.
- Registry shutdown fences new admission synchronously, drains reservations and disposes all owned runtimes before provider infrastructure is released.
- Keep WarmExecutionPool as the separate resource-capacity/LRU policy. Do not infer transcript eviction or native replay completeness from cooling or a provider's native-history capability.
- The application registry now tracks tab allocations, including drafts and later conversation rebinding. Registration release belongs to runtime teardown, not temporary presentation detach. History status/Stop, archive eligibility, deletion cancellation and unload use this registry; global creation reservation and resource invalidation are not yet migrated. The current migration has not enabled close-to-detach. Do not change close behavior before status/Stop, deletion/archive, resource invalidation, persistence and unload have been routed through runtime ownership and tested.

- Runtime controller factories must read DOM, selectors and view actions through the current presentation. Use structural selection readers and nullable surfaces; do not capture the original DOM/UI object or view in a retained controller. Conversation transcript listeners attach with an exact release handle.
