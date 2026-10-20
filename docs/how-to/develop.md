# Develop Music Metadata Manager

Install the exact versions in `.python-version`, `.node-version`, `global.json`, and `package.json`, plus Docker on Linux x64. Run `./plugin bootstrap` from the checkout to verify the toolkit archive, restore locked dependencies, and prepare official Jellyfin references.

Run `./plugin dev --port 18096` for the owned disposable server. Optional media mounts are read-only. The shared supervisor owns only this checkout's sandbox.

Use `./plugin build frontend` or `./plugin build backend` while developing, and `./plugin build` to produce complete distributions. Run `./plugin check`, `./plugin test`, and `./plugin validate --full` before release. Dependencies must already be restored for checks.

Browser fixtures use synthetic API responses and verify the current page at wide and narrow sizes, dark themes, keyboard navigation, stale responses and operation feedback. Installation tests use random owned containers with synthetic media and empty initial configuration, exercise current-format import/export and correction workflows, and verify same-version restart recovery. They require no runtime credentials or production fixtures.
