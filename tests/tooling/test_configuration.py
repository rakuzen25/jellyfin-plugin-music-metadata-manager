"""Consumer identity, inventory and architecture compatibility contracts."""

import unittest
from pathlib import Path

from jellyfin_plugin_toolkit.checks.architecture import check_projects
from jellyfin_plugin_toolkit.common.source_inventory import source_files
from jellyfin_plugin_toolkit.context import Context


class ConsumerTests(unittest.TestCase):
    def test_identity_paths_and_persistence_contracts_remain_stable(self):
        context = Context.load()
        self.assertEqual(
            "86400cc2-d51e-4695-82c0-5d4f61d3a1f7", context.identity["guid"]
        )
        self.assertEqual(
            "Jellyfin.Plugin.MusicMetadataManager", context.identity["assembly"]
        )
        self.assertEqual(
            "musicmetadatamanager", context.config["sandbox"]["settings_page"]
        )
        self.assertFalse(context.config["distribution"]["web"])
        self.assertEqual(
            {"Core", "Infrastructure", "Host"},
            set(context.config["backend"]["projects"]),
        )
        check_projects(context.root)

    def test_public_source_inventory_excludes_operational_material(self):
        context = Context.load()
        files = source_files(context.root)
        for path in files:
            self.assertNotIn(".build", path.parts)
            self.assertNotIn("runtime", path.parts)
            self.assertNotIn("DEPLOYMENT.md", path.parts)
        self.assertIn(Path("tests/fixtures/previous-0.6.1-source.zip"), files)
        self.assertIn(Path("frontend/admin/config.ts"), files)

    def test_current_inputs_and_removed_legacy_paths_are_classified(self):
        from jellyfin_plugin_toolkit.ci.policy import classification

        context = Context.load()
        for path in [
            *(p.as_posix() for p in source_files(context.root)),
            "core/Rules.cs",
            "web/config.html",
        ]:
            with self.subTest(path=path):
                classification(path, context.root)
