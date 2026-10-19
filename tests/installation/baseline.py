"""Rebuild the preserved prior plugin with the same verified official references."""

import hashlib
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

from jellyfin_plugin_toolkit.build.backend import HOST_LIBRARIES, reference_directory
from jellyfin_plugin_toolkit.build.package_artifacts import archive
from jellyfin_plugin_toolkit.context import Context


def prior_package():
    ctx = Context.load()
    fixture = ctx.root / "tests/fixtures"
    metadata = json.loads((fixture / "previous-0.6.1.json").read_text())
    source = fixture / metadata["source"]
    if hashlib.sha256(source.read_bytes()).hexdigest() != metadata["sha256"]:
        raise ValueError("Prior-source fixture checksum differs")
    output = ctx.root / ".build/compatibility"
    output.mkdir(parents=True, exist_ok=True)
    target = output / "prior-0.6.1.zip"
    with tempfile.TemporaryDirectory(prefix="previous-manager-") as directory:
        root = Path(directory)
        with zipfile.ZipFile(source) as package:
            from jellyfin_plugin_toolkit.acceptance import members

            members(package)
            package.extractall(root)
        payload = root / "payload"
        subprocess.run(
            [
                "dotnet",
                "publish",
                str(root / "src/Plugin.csproj"),
                "-c",
                "Release",
                "-o",
                str(payload),
                "-p:JellyfinReferenceDir=" + str(reference_directory()),
                "-p:Deterministic=true",
                "-p:PathMap=" + str(root) + "=/_/",
                "-p:EnableSourceControlManagerQueries=false",
                "-p:IncludeSourceRevisionInInformationalVersion=false",
                "--nologo",
                "-m:1",
            ],
            check=True,
        )
        for binary in payload.glob("*.dll"):
            if binary.name.startswith(HOST_LIBRARIES):
                binary.unlink()
        (payload / "meta.json").write_text(
            json.dumps(
                {
                    "guid": metadata["guid"],
                    "name": ctx.identity["name"],
                    "version": "0.6.1.0",
                    "targetAbi": ctx.config["host"]["abi"],
                    "status": "Active",
                    "assemblies": [p.name for p in payload.glob("*.dll")],
                }
            )
        )
        archive(
            target,
            [(p, p.relative_to(payload)) for p in payload.rglob("*") if p.is_file()],
        )
    return target
