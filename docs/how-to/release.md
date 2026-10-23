# Prepare a release

All repository writes require the existing GitHub App; there is no workflow-token fallback. Release uploads use the App, while validation reads, CI artifacts, and attestations use the workflow token. After configuring the existing App credentials, dispatch **Set up connected GitHub App** and merge its reviewed configuration PR. Default-branch pushes also check setup. The workflow discovers the identity and manages its Renovate entry and ownership record; toolkit synchronization waits for that PR, while releases continue. Closing the PR pauses automatic retries until manual dispatch.

Run `uv run jpt validate` with the locked toolkit. Build and inspect the plugin ZIP, matching source ZIP, manifest, checksums and provenance under `dist`. This plugin embeds its administrator page and does not produce a standalone web ZIP.

Release preparation creates reviewed version changes and unpublished drafts. The shared release workflow performs fresh installation, reproducibility and dependency-advisory checks and attaches authenticated evidence for the exact candidate bytes. Toolkit wheel, workflow revisions and Renovate preset must agree.

Review the draft's evidence and catalog policy before manual publication. Production installation is separate. Back up server configuration and plugin journal consistently, stop the server, install the declared plugin payload, then verify behavior before resuming normal operation. See [configuration and state](../reference/state.md). The initial release starts from empty plugin state; no upgrade or prior-format compatibility is provided.
