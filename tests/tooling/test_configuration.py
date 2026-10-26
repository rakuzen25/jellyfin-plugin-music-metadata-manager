"""Repository tooling checks. Consumer identity, inventory and architecture contracts."""

import unittest
from pathlib import Path

from jellyfin_plugin_toolkit.checks.architecture import check_projects
from jellyfin_plugin_toolkit.common.source_inventory import source_files
from jellyfin_plugin_toolkit.context import Context


class ConsumerTests(unittest.TestCase):
    def test_baseline_identity_paths_and_architecture(self) -> None:
        context = Context.load()
        self.assertEqual("86400cc2-d51e-4695-82c0-5d4f61d3a1f7", context.identity.guid)
        self.assertEqual(
            "Jellyfin.Plugin.MusicMetadataManager", context.identity.assembly
        )
        self.assertEqual("musicmetadatamanager", context.config.sandbox.settings_page)
        self.assertFalse(context.config.distribution.web)
        self.assertEqual(
            {"Core", "Application", "Infrastructure", "Host"},
            set(context.config.backend.projects),
        )
        check_projects(context.root)

    def test_public_source_inventory_excludes_operational_material(self) -> None:
        context = Context.load()
        files = source_files(context.root)
        for path in files:
            self.assertNotIn(".build", path.parts)
            self.assertNotIn("runtime", path.parts)
            self.assertNotIn("DEPLOYMENT.md", path.parts)
        self.assertIn(Path("frontend/admin/config.ts"), files)

    def test_maintained_inputs_are_classified(self) -> None:
        from jellyfin_plugin_toolkit.ci.policy import classification

        context = Context.load()
        for path in (p.as_posix() for p in source_files(context.root)):
            with self.subTest(path=path):
                classification(context, path)

    def test_git_inventory_does_not_track_execution_reports(self) -> None:
        import subprocess

        root = Context.load().root
        if not (root / ".git").exists():
            return
        names = subprocess.check_output(
            ["git", "-C", str(root), "ls-files", "-z"], text=True
        ).split("\0")
        for name in names:
            with self.subTest(path=name):
                self.assertFalse(
                    any(
                        part.startswith("results-run.") or part == "TestResults"
                        for part in Path(name).parts
                    )
                )
