# Architecture

`src/Core` owns host-independent correction policy, matching, DTOs and interfaces. `src/Infrastructure` implements atomic JSON storage, clock access and serialized refresh queues. `src/Host` owns authenticated Jellyfin APIs, native entities, registration, lifecycle hooks, and the correction coordinator.

The correction coordinator's partial files separate draft editing, review preparation and projections while retaining one synchronization gate and the existing persistence ordering. Configuration, journal, clock and work queue interfaces make those effects explicit.

`frontend/admin` contains typed feature modules with explicit imports and local state. Features register before initialization connects DOM events and cross-feature calls. Application-owned review tokens, navigation, serialized writes and uncertain-write handling remain local. The shared build bundles the administrator page without changing its route or appearance.

`plugin.toml`, `version.txt`, and `toolkit.lock.json` select the shared foundation. Native tool pins and dependency lockfiles remain authoritative. The toolkit owns build, sandbox, validation and release mechanics; the plugin owns API contracts, state schemas, workflows and tests.
