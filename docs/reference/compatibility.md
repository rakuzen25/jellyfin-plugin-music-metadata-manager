# Compatibility and rollback

The immutable plugin GUID is `86400cc2-d51e-4695-82c0-5d4f61d3a1f7`. The host assembly remains `Jellyfin.Plugin.MusicMetadataManager`, the settings-page identifier is `musicmetadatamanager`, and administrator routes remain under `/MusicMetadataManager`.

Configuration remains `plugins/configurations/Jellyfin.Plugin.MusicMetadataManager.xml` under Jellyfin's configuration directory. Journal state remains `data/MusicMetadataManager/state.json` under the server data directory. Preserve both together. XML and JSON formats and schema 1/2 import compatibility remain unchanged; current exports use schema 3.

Preview never activates changes. Activation applies exactly the reviewed version; configuration or affected metadata changes invalidate previews. Reviews expire after fifteen minutes or restart. Draft deletion preserves an active version. Restoration records retain original values and pending refresh work resumes after restart.

Before removing the plugin, preview disabling active rules, activate, wait for pending work, and verify restored metadata. Keep configuration, journal and a consistent server backup. Emergency rollback requires stopping the server before restoring that backup, which also reverts intervening library and user changes. Never discard journal state while corrections remain active.

The prior-version acceptance fixture is a characterization build from preserved local 0.6.1 source. Its recorded digest does not assert that it is a historically published binary.
