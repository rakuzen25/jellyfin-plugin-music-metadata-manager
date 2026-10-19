# Configuration and state

Music Metadata Manager 0.1.0 is the initial, never-deployed baseline. Its rules documents and journal use schema 1. Imports require the full current document shape and exact schema version. Other formats are rejected; no migration or conversion is performed.

Configuration is stored at `plugins/configurations/Jellyfin.Plugin.MusicMetadataManager.xml` under Jellyfin's configuration directory. Journal state is stored at `data/MusicMetadataManager/state.json` under the server data directory. The journal records original values, applied corrections, reports and pending refresh work. Writes replace the journal atomically, and pending work resumes after restart.

Preview never activates changes. Activation applies exactly the reviewed document and metadata state. Reviews expire after fifteen minutes or restart. Draft deletion leaves an active entry unchanged.

Before removing the plugin, preview disabling active rules, activate, wait for pending work, and verify restored metadata. Preserve configuration and journal together until restoration finishes. Never discard the journal while corrections remain active.
