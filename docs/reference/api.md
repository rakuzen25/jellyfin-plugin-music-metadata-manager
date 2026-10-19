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

Identity, artwork, policy and cleanup endpoints are declared in `src/Host/Api.cs`; their operations use the same administrator authorization and review ownership rules.
