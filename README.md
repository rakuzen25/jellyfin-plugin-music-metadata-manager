# Music Metadata Manager

Review music metadata corrections, artist identities, artwork decisions and library issues in Jellyfin. Original media remains unchanged. The supported build is the pinned Jellyfin 12.2.0.0 Linux x64 image with .NET 10.

## Use

Open Dashboard → Plugins → Music Metadata Manager → Settings. Choose a music library, select a track or album folder, and enter only the fields to manage. Opening Edit keeps changes local and leaves the current active version in force. Preview changes reviews the form directly; Apply changes installs exactly that reviewed version. Cancel discards local edits. Save draft explicitly stores pending changes for later; active rules with drafts show “Active · pending changes” with resume/discard actions. Rules remain enforced on metadata refresh, library scan, and **Reapply active corrections**. Native metadata edits to managed fields last until the next such operation.

Artist-credit mappings match whole strings exactly, including Unicode and whitespace. They never guess how to split punctuation. Choose performers, album artists, or both; performer mappings are the default. The album's performer list aggregates corrected child-track performers when any child performer correction applies. Album-artist credits remain separate. Explicit album performer lists override aggregation.

Album rules supply an album title and optional defaults to tracks already grouped in that folder. Exact track fields override album defaults; explicit field lists override aliases. Aliases expand once, without chaining. Same-specificity overlapping field/credit rules are rejected. Blank editor fields are unmanaged, not requests to clear values. Disc/track numbers must be positive. No wildcard/regex rules, cross-folder regrouping, nonmusic metadata, or sidecar writes are supported.

Active rules override locks for their specified fields only. The plugin preserves lock settings and unrelated fields, including composer credits. Disabling/deleting an active rule requires preview and activation and refreshes affected items through Jellyfin's providers. For locked or cached fields that retain the last correction, the recorded pre-correction value is restored. Provider results can differ from the removal preview. Draft deletion is immediate and preserves any active version with the same ID. Never discard plugin state before deactivating rules and verifying restoration.

The initial 0.1.0 baseline uses schema 1 for JSON exports and includes correction rules, identities, metadata policies and their drafts. Only the complete current format is accepted; no prior-version imports or migrations are supported. Import validates the document and merges its rules as drafts (draft entries win when an exported ID exists in both sections). Import never directly changes active rules. A new preview is required after editing rules or changing affected metadata. Reviews expire after 15 minutes or server restart.

## Development

```sh
uv run jpt bootstrap
uv run jpt dev
uv run jpt check
uv run jpt test
uv run jpt validate
```

See [development](docs/how-to/develop.md), [architecture](docs/explanation/architecture.md), [configuration and state](docs/reference/state.md), [administrator API](docs/reference/api.md), [release preparation](docs/how-to/release.md), and the [capability preservation matrix](docs/reference/capabilities.md), and the [full sweep report](docs/reference/full-sweep.md).

Original source is [Apache-2.0](LICENSE); [NOTICE](NOTICE) and [GPLv3 distribution material](GPL-3.0.txt) accompany compiled distributions.

Use `pnpm check` (or `uv run jpt check`) to verify formatting and linting across the frontend, C# backend, Python tooling, configuration and docs. Use `pnpm format` to apply formatting, or add a target such as `frontend`, `backend`, `tooling` or `docs`. uv synchronizes Python dependencies automatically; run `uv run jpt bootstrap` first to prepare Node, .NET and Jellyfin integrations. CI runs these same checks and requires the aggregate `validation / validate` result.
