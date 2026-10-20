# Administrator API

All `/MusicMetadataManager` routes require administrator authentication. The ordinary Jellyfin plugin-configuration write endpoint is rejected; use the preview and activation workflow.

| Operation                          | Route                                                           |
| ---------------------------------- | --------------------------------------------------------------- |
| Read libraries, rules and status   | `GET libraries`, `GET rules`, `GET status`                      |
| Search items                       | `GET items?search=…&library=…`                                  |
| Export or import versioned state   | `GET export`, `POST import`                                     |
| Validate imported state            | `POST validate`                                                 |
| Save or discard a rule draft       | `POST drafts`, `DELETE drafts/{id}`                             |
| Review proposed changes            | `POST preview` with edits, activateIds, disableIds or deleteIds |
| Activate a review                  | `POST activate` with the returned token                         |
| Reapply current active corrections | `POST apply`                                                    |

Import merges entries as drafts and never changes active rules directly. A preview must be recreated after relevant configuration or metadata changes. Status includes unmatched rules, pending work and recent per-item errors. Item failures do not stop correction of other items.

Identity endpoints are declared in `src/Host/Api.cs`; metadata, source comparison, artwork, inventory and issue endpoints are declared in `src/Host/ManagerApi.cs`. All use administrator authorization.

`GET manager/fields` returns the authoritative field catalog: names, value kinds, required status, supported targets and advanced-editor classification. Rule `fields` and `trackDefaults` contain only a `decisions` map. For example, `{"decisions":{"title":{"mode":"approved","value":"Reviewed title","provenance":"known"}}}` manages the title. Metadata policies use the same field-decision values in their `fields` map. There is no parallel scalar representation.

Review responses contain typed item, metadata, identity, restoration and cleanup projections. Activation returns the committed revision, queued count and per-item cleanup outcomes. Cleanup can report a blocked or failed item independently of other outcomes.

Errors include a stable `code` and displayable `error`. Codes distinguish validation failures, rule conflicts, stale state, unavailable sources, cancellation and unavailable storage. A `rule_conflict` response includes `ruleIds`; clients must not parse human messages to identify rules. A lost connection during a write leaves its outcome uncertain: reload rules/status before retrying, and obtain a new activation review.

See the [capability matrix](capabilities.md) for the complete workflow inventory and [state reference](state.md) for durability and recovery.
