# Capability preservation

The fresh baseline preserves every existing operation. Breaking storage and JSON representations do not remove workflows. Each row identifies regression coverage; tests must exercise the listed behavior before the sweep is complete.

| Capability                     | Required scenarios                                                                   | Regression coverage                                          |
| ------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Track and album rules          | Exact paths, defaults, precedence, conflicts, unmanaged fields                       | Core rule tests; installation media                          |
| Credit mappings                | Exact Unicode/whitespace, roles, single expansion, album aggregation                 | Core rule tests; installation media                          |
| Artist identities              | Representatives, linked records, normalized aliases, search, scopes                  | Core identity tests; installation manager                    |
| Native presentation            | Artist/person links, native filters, pagination and favorites                        | Host boundary tests; installation manager                    |
| Playback and scrobbling        | Presentation does not rewrite native playback credits                                | Host playback tests; installation media hashes               |
| Library inventory              | Grouped/native views, search, kinds, pagination, album tracks                        | Browser workflows; installation inventory                    |
| Metadata editing               | Every field, approved/empty/unmanaged, locks and provenance                          | Core field tests; browser metadata; installation manager     |
| Source comparison              | Explicit binding, detached lookup, snapshots, timeout and failure                    | Host source tests; browser comparison                        |
| Artwork                        | Upload, provider cache, pin current, preview, restore, corrupt/missing pins          | Host artwork tests; browser artwork; installation manager    |
| Local editing                  | Resume, discard, back navigation, dirty edits and nested editors                     | Browser navigation and metadata                              |
| Draft lifecycle                | Save/delete/discard, active-plus-draft, typed bulk selection                         | Application drafts; browser bulk                             |
| Import/export                  | Complete current format, draft merge, active state isolation                         | Core serialization; application import; installation         |
| Reviewed activation            | Exact state, expiry, stale rejection, one-use tokens                                 | Application reviews; browser review; installation            |
| Bulk operations                | Rules, identities, policies, eligible/skipped selection                              | Application candidates; browser bulk                         |
| Issues                         | Credits, bindings, repair, orphan, blocked, reports, unmatched, recreation, audit    | Browser guided issues; installation manager                  |
| Reports                        | Occurrence acknowledgment, archive, live conditions remain                           | Application reports; browser issues                          |
| Cleanup                        | Review fingerprint, dependencies, internal paths, recovery copies, per-item outcomes | Host cleanup; installation manager                           |
| Restoration                    | Stop managing retains values; restore original; explicit removal refreshes           | Application reconciliation; installation manager             |
| Background enforcement         | Provider, refresh completion, scan, manual apply, missing targets                    | Host hooks; installation media                               |
| Recovery                       | Pending operations, cancellation, failures, same-version restart                     | Infrastructure/application fault tests; installation restart |
| Dashboard ownership            | Duplicate actions, serialized writes, stale reads, uncertain writes, feedback        | Frontend ownership tests; browser contracts                  |
| Accessibility                  | Wide/narrow, dark host, keyboard, focus, announcements                               | Browser contracts                                            |
| Authorization and media safety | Admin APIs, user-scoped identities, read-only audio, unrelated fields                | Host boundaries; installation acceptance                     |
| Distribution                   | Locked tools, official ABI, source ZIP, licenses, reproducible payload               | Full validation                                              |
