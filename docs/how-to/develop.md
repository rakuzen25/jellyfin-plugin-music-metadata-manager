# Develop Music Metadata Manager

Install the exact versions in `.python-version`, `.node-version`, `global.json`, and `package.json`, plus Docker on Linux x64. Run `./plugin bootstrap` from the checkout to verify the toolkit archive, restore locked dependencies, and prepare official Jellyfin references.

Run `./plugin dev --port 18096` for the owned disposable server. Optional media mounts are read-only. The shared supervisor owns only this checkout's sandbox.

Use `./plugin build frontend` or `./plugin build backend` while developing, and `./plugin build` to produce complete distributions. Run `./plugin check`, `./plugin test`, and `./plugin validate --full` before release. Dependencies must already be restored for checks.

Browser fixtures use synthetic API responses and compare the migrated page with a preserved previous page at wide and narrow sizes. Comparisons retain the previous page as their reference and allow only sparse native-control edge rounding (at most sixteen pixels with an eight-level channel difference). Installation tests build the preserved prior source, use random owned containers and synthetic media/configuration, and exercise restart, upgrade and rollback. They require no runtime credentials or production fixtures.
