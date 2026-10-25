"""Fresh baseline acceptance on an owned official-image fixture and synthetic media."""

import copy
import urllib.error
import urllib.request
import uuid
from typing import Any

from jellyfin_plugin_toolkit.acceptance import inventory
from jellyfin_plugin_toolkit.context import Context
from jellyfin_plugin_toolkit.installation import Session as BaseSession

from .manager import characterize_manager
from .media import MusicSession as Session
from .media import characterize_media, wait_for


def endpoint(
    session: BaseSession,
    path: str,
    method: str = "GET",
    body: dict[str, Any] | None = None,
) -> Any:
    return session.call("/MusicMetadataManager/" + path, method, body)


def characterize(session: BaseSession) -> dict[str, Any]:
    initial = endpoint(session, "rules")
    assert (
        initial["schemaVersion"] == 1
        and initial["active"] == []
        and initial["drafts"] == []
    )
    try:
        urllib.request.urlopen(session.base + "/MusicMetadataManager/rules", timeout=10)
    except urllib.error.HTTPError as error:
        assert error.code in (401, 403)
    else:
        raise AssertionError("Administrator API admitted an anonymous request")
    for version in [0, 2, 3]:
        unsupported = copy.deepcopy(initial)
        unsupported["schemaVersion"] = version
        try:
            endpoint(session, "import", "POST", unsupported)
        except urllib.error.HTTPError as error:
            assert error.code == 400
        else:
            raise AssertionError("Unsupported import format was accepted")
        assert endpoint(session, "rules") == initial
    try:
        endpoint(
            session, "import", "POST", {"schemaVersion": 1, "active": [], "drafts": []}
        )
    except urllib.error.HTTPError as error:
        assert error.code == 400
    else:
        raise AssertionError("Incomplete import shape was accepted")
    assert endpoint(session, "rules") == initial
    session.call(
        "/Library/VirtualFolders?name=Fixture%20music&collectionType=music&refreshLibrary=false",
        "POST",
        {
            "LibraryOptions": {
                "PathInfos": [{"Path": "/fixture-media"}],
                "EnableInternetProviders": False,
                "EnableRealtimeMonitor": False,
                "SaveLocalMetadata": False,
            }
        },
    )
    libraries = endpoint(session, "libraries")
    assert len(libraries) == 1
    track, baseline, current = characterize_media(session, endpoint)
    rule = {
        "id": uuid.uuid4().hex,
        "label": "Portable characterization",
        "kind": "track",
        "path": "/fixture-media/track.flac",
        "libraries": [libraries[0]["id"]],
        "fields": {
            "decisions": {
                "title": {"mode": "approved", "value": "Reviewed synthetic title"}
            }
        },
        "trackDefaults": {},
    }
    endpoint(session, "drafts", "POST", rule)
    document = endpoint(session, "rules")
    assert (
        document["revision"] == initial["revision"] + 1
        and len(document["drafts"]) == 1
        and not document["active"]
    )
    preview = endpoint(session, "preview", "POST", {"activateIds": [rule["id"]]})
    another = copy.deepcopy(rule)
    another["id"] = uuid.uuid4().hex
    another["label"] = "Separate saved draft"
    another["path"] = "/fixture-media/other.wav"
    endpoint(session, "drafts", "POST", another)
    try:
        endpoint(session, "activate", "POST", {"token": preview["token"]})
    except urllib.error.HTTPError as error:
        assert error.code == 409
    else:
        raise AssertionError(
            "Configuration write did not invalidate the previous preview"
        )
    fresh = endpoint(session, "preview", "POST", {"activateIds": [rule["id"]]})
    endpoint(session, "activate", "POST", {"token": fresh["token"]})
    applied = wait_for(
        "reviewed title application",
        current,
        lambda values: values["title"] == "Reviewed synthetic title",
    )
    for field in ["album", "artists", "albumArtists", "discNumber", "trackNumber"]:
        assert applied[field] == baseline[field], field
    document = endpoint(session, "rules")
    assert [r["id"] for r in document["active"]] == [rule["id"]] and [
        r["id"] for r in document["drafts"]
    ] == [another["id"]]
    removal = endpoint(session, "preview", "POST", {"disableIds": [rule["id"]]})
    endpoint(session, "activate", "POST", {"token": removal["token"]})
    restored = wait_for(
        "original title restoration",
        current,
        lambda values: values["title"] == baseline["title"],
    )
    for field in ["album", "artists", "albumArtists", "discNumber", "trackNumber"]:
        assert restored[field] == baseline[field], field
    endpoint(session, "drafts", "POST", rule)
    reapply = endpoint(session, "preview", "POST", {"activateIds": [rule["id"]]})
    endpoint(session, "activate", "POST", {"token": reapply["token"]})
    wait_for(
        "reactivation",
        current,
        lambda values: values["title"] == "Reviewed synthetic title",
    )
    document = endpoint(session, "rules")
    characterize_manager(session, endpoint, track)
    document = endpoint(session, "rules")
    endpoint(session, "import", "POST", document)
    imported: dict[str, Any] = endpoint(session, "rules")
    assert imported["active"] == document["active"] and len(imported["drafts"]) == 2
    session.restart()
    session.assert_loaded()
    assert endpoint(session, "rules") == imported
    assert (session.root / "config/data/MusicMetadataManager/state.json").is_file()
    assert (session.root / "config/data/MusicMetadataManager").is_dir()
    return imported


def main() -> None:
    context = Context.load()
    inventory(context)
    with Session(context) as session:
        characterize(session)
    print(
        "PASS: fresh installation, administrator authorization, draft/preview/activation/import, native correction/restoration, retained metadata, artwork, identity favorites, cleanup safeguards, same-version restart preserve current configuration, journal state and media bytes"
    )


if __name__ == "__main__":
    main()
