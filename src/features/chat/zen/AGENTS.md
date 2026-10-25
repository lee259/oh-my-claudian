# Zen Presentation

- `ZenModeController` is the sole workspace placement owner. It selects one registered main-window sidebar surface, loads existing deferred leaves at most once, and returns the surface to its exact origin before view/runtime cleanup.
- Move the existing view DOM; do not create another composer, transcript renderer, runtime, session binding, or provider execution. Source view handlers must travel with the moved surface, and Zen focus must use the chat scope instead of the note's scope.
- `ZenModePanelView` owns the Preact controls and an opaque slot for the retained chat surface. Return that surface to its origin before unmounting Preact; never reconcile or clone its children. `ZenModePanel` owns the native overlay container, layout classes, focus scope and scroll restoration.
- The native central split sizes all direct children as panes. Keep an explicit overlay sizing override; verify actual native geometry after sidebar animations, viewport changes and expanded history.
- Position is a workspace-relative offset from the bottom-center dock. Clamp only rendered placement on resize; persist on completed pointer/keyboard actions, never on ResizeObserver callbacks. Cancelled drags restore the prior position.
