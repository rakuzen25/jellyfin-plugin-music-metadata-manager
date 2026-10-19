# Architecture

Core owns correction matching, precedence, field definitions, identities, restoration decisions and named JSON contracts. It has no Jellyfin dependencies. A field has one decision map; typed C# accessors read and write that map without maintaining a second representation.

Application owns document validation, candidate construction, drafts, review sessions, activation and recoverable per-item reconciliation. Its state coordinator serializes mutations. Document readers receive detached copies of the last committed document. Host effects are supplied through workflow ports.

Infrastructure implements the atomic state store, content-addressed artwork storage, clock and refresh queue. Application depends on Core; Infrastructure depends on Application and Core. Host composes all three and owns authenticated APIs, native metadata writes, provider lookup, EF inventory inspection, cleanup recovery and lifecycle hooks. Runtime host types never enter Application or Core.

The rules document, management ledger and admitted work are one committed state snapshot. Activation saves that snapshot before queue admission or cleanup effects. Per-item reconciliation saves original values before native writes and acknowledges work after field and image writes succeed. Reviewed cleanup retains recovery material before deletion and checks its fingerprint again after copying. See [state](../reference/state.md).

The administrator page has application-owned document and editor/session stores. Controllers receive narrow callback dependencies, rather than a universal feature registry. Transport is separate from command and notification ownership. Inventory, field editing, source comparison and artwork rendering are separate metadata-editor components. Runtime imports must be acyclic; type-only controller contracts describe composition callbacks.

`plugin.toml` declares the project graph, distribution payload and validation groups. The locked toolkit owns build and release mechanics; this plugin owns behavior contracts and the [capability preservation matrix](../reference/capabilities.md).
