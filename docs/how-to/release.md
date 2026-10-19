# Prepare a release

Run `./plugin validate --full` with the locked toolkit. Build and inspect the plugin ZIP, matching source ZIP, manifest, checksums and provenance under `dist`. This plugin embeds its administrator page and does not produce a standalone web ZIP.

Release preparation creates reviewed version changes and unpublished drafts. The shared release workflow performs fresh installation, reproducibility and dependency-advisory checks and attaches authenticated evidence for the exact candidate bytes. Toolkit archive, workflow revisions and Renovate preset must agree.

Review the draft's evidence and catalog policy before manual publication. Production installation is separate. Back up server configuration and plugin journal consistently, stop the server, install the declared plugin payload, then verify behavior before resuming normal operation. See [configuration and state](../reference/state.md). The initial release starts from empty plugin state; no upgrade or prior-format compatibility is provided.
