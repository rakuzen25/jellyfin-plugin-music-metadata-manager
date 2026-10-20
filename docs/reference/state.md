# Configuration and state

Music Metadata Manager 0.1.0 is the initial baseline. Document and state formats use schema 1 and accept only the current shape. No prior-format migration or conversion is provided.

The authoritative file is `data/MusicMetadataManager/state.json` under the Jellyfin server data directory. Its envelope contains `schemaVersion`, `document` and `journal`. The document includes the active rules, drafts, identities and metadata policies. The journal contains one record per managed item, original/applied fields and images, history, reports, restoration requests, and pending work with its provider-refresh intent. Pending reviewed cleanups include their fingerprint and retained recovery path.

Jellyfin plugin configuration is a host settings boundary; it does not contain a separate copy of the rules document. All rule changes use the administrator API. The ordinary plugin-configuration write endpoint remains rejected. Export produces the document, and import merges current-format entries as drafts without activating them.

State writes serialize to a temporary file, flush it and atomically replace the authoritative file. A failed commit restores the previous in-memory snapshot. Activation commits the reviewed document, restoration records and admitted work together before native effects. Per-item original values are saved before native metadata or artwork writes. Work is acknowledged only after successful reconciliation.

Reviews expire after fifteen minutes or restart and are consumed by a successful commit. Relevant document, metadata or dependency changes require a new review. Draft deletion preserves an active entry with the same ID.

`pins/` holds content-addressed artwork; publication is atomic and approvals verify its SHA256 and decoding. `sources.json` retains confirmed source-comparison evidence. `music-records.json` retains scoped inventory evidence. `recovery/` contains reviewed cleanup backups. Cleanup rejects symbolic links and rechecks the native record, dependencies and internal file hashes before deleting through Jellyfin.

After a same-version restart, pending metadata work resumes with its recorded refresh intent. Pending cleanup resumes only after rechecking its reviewed fingerprint. A completed deletion interrupted before acknowledgment is reconciled using retained recovery evidence. No media tags or sidecars are written.

Before removing the plugin, preview disabling active rules, activate, wait for work to finish and verify restoration. Preserve the entire plugin data directory until restoration is complete. Never discard the management ledger while corrections remain active.
