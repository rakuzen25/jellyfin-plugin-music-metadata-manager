# Develop Music Metadata Manager

Install uv at the version required by `pyproject.toml`, Node and pnpm from `.node-version` and `package.json`, the .NET SDK from `global.json`, and Docker on Linux x64. uv downloads the Python version in `.python-version`. Run `uv sync --locked`, then `uv run jpt bootstrap` to restore Node/.NET dependencies and prepare official Jellyfin references.

This repository is an independent uv project. `uv.lock` records the released toolkit wheel URL, version and SHA256. Toolkit operations export shared resources under `.build/jpt`. Source bundles retain the exact wheel and matching source distribution; reconstruction with an empty cache may require network access. Use `uv add` for dependency changes; the project enforces a 24-hour release-age cutoff.

Run `uv run jpt dev --port 18096` for the owned disposable server. Optional media mounts are read-only. The shared supervisor owns only this checkout's sandbox.

Use `uv run jpt build frontend` or `uv run jpt build backend` while developing, and `uv run jpt build` to produce complete distributions. Run `uv run jpt check`, `uv run jpt test`, and `uv run jpt validate` before release. Local uv commands synchronize Python dependencies automatically. CI uses `uv sync --locked` followed by `uv run --no-sync jpt …`; bootstrap prepares the other integrations.

Browser fixtures use synthetic API responses and verify the current page at wide and narrow sizes, dark themes, keyboard navigation, stale responses and operation feedback. Installation tests use random owned containers with synthetic media and empty initial configuration, exercise current-format import/export and correction workflows, and verify same-version restart recovery. They require no runtime credentials or production fixtures.
