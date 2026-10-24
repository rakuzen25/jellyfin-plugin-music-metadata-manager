"""Reviewed metadata ownership, artwork, identity favorites and cleanup safeguards."""

import hashlib
import json
import struct
import urllib.error
import urllib.request
import uuid
import zlib
from collections.abc import Callable
from typing import Any, TypedDict

from jellyfin_plugin_toolkit.installation import Session

from .media import Endpoint, wait_for


class MetadataPolicy(TypedDict):
    id: str
    itemId: str
    label: str
    libraries: list[str]
    fields: dict[str, dict[str, str]]
    images: dict[str, dict[str, Any]]


class IdentityPolicy(TypedDict):
    id: str
    preferredName: str
    aliases: list[str]
    libraries: list[str]
    artistId: str
    personId: str


def expect_rejected(
    action: Callable[[], object], statuses: tuple[int, ...] = (400, 409)
) -> None:
    try:
        action()
    except urllib.error.HTTPError as error:
        assert error.code in statuses, error.code
    else:
        raise AssertionError("Unsafe operation was admitted")


def upload_image(session: Session) -> dict[str, Any]:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    image = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress((b"\0" + bytes([30, 80, 140]) * 8) * 8))
        + chunk(b"IEND", b"")
    )
    boundary = "fixture-" + uuid.uuid4().hex
    body = (
        (
            "--"
            + boundary
            + '\r\nContent-Disposition: form-data; name="file"; filename="fixture.png"\r\nContent-Type: image/png\r\n\r\n'
        ).encode()
        + image
        + ("\r\n--" + boundary + "--\r\n").encode()
    )
    request = urllib.request.Request(
        session.base + "/MusicMetadataManager/manager/images/upload",
        data=body,
        headers={
            "Authorization": 'MediaBrowser Token="' + session.token + '"',
            "Content-Type": "multipart/form-data; boundary=" + boundary,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        decision: dict[str, Any] = json.load(response)
    assert decision["hash"].lower() == hashlib.sha256(image).hexdigest()
    return decision


def characterize_manager(
    session: Session, endpoint: Endpoint, track: dict[str, Any]
) -> None:
    def apply(change: dict[str, Any]) -> Any:
        review = endpoint(session, "preview", "POST", change)
        return endpoint(session, "activate", "POST", {"token": review["token"]})

    def detail() -> dict[str, Any]:
        result: dict[str, Any] = endpoint(session, "manager/items/" + track["id"])
        return result

    before = detail()
    original = before["stored"]["overview"]
    policy: MetadataPolicy = {
        "id": uuid.uuid4().hex,
        "itemId": track["id"],
        "label": "Portable metadata ownership",
        "libraries": [track["library"]],
        "fields": {
            "overview": {
                "mode": "approved",
                "value": "Retained fixture overview",
                "provenance": "known",
            }
        },
        "images": {"Primary": upload_image(session)},
    }
    apply({"metadataEdits": [policy]})
    wait_for(
        "approved overview and artwork",
        detail,
        lambda row: (
            row["stored"]["overview"] == "Retained fixture overview"
            and any(image["type"] == "Primary" for image in row["images"])
        ),
    )
    pinned = endpoint(
        session,
        "manager/items/" + track["id"] + "/images/Primary/pin-current",
        "POST",
        {},
    )
    assert pinned["hash"] == policy["images"]["Primary"]["hash"]
    apply(
        {
            "relinquish": [
                {
                    "itemId": track["id"],
                    "fields": ["overview"],
                    "images": [],
                    "restoreOriginal": False,
                }
            ]
        }
    )
    retained = detail()
    assert retained["stored"]["overview"] == "Retained fixture overview"
    assert retained["original"]["original"]["overview"] == original
    apply(
        {
            "relinquish": [
                {
                    "itemId": track["id"],
                    "fields": ["overview"],
                    "images": ["Primary"],
                    "restoreOriginal": True,
                }
            ]
        }
    )
    wait_for(
        "retained original restoration",
        detail,
        lambda row: (
            row["stored"]["overview"] == original
            and not any(image["type"] == "Primary" for image in row["images"])
        ),
    )
    # Audio cannot be deleted through orphan-record cleanup.
    expect_rejected(
        lambda: endpoint(session, "preview", "POST", {"cleanupIds": [track["id"]]})
    )

    records = endpoint(session, "identities/records")
    artists = [
        record for record in records["artists"] if record["name"] == "Fixture artist"
    ]
    persons = [
        record for record in records["persons"] if record["name"] == "Fixture artist"
    ]
    assert len(artists) == len(persons) == 1, records
    identity: IdentityPolicy = {
        "id": uuid.uuid4().hex,
        "preferredName": "Fixture preferred artist",
        "aliases": ["Fixture artist"],
        "libraries": [track["library"]],
        "artistId": artists[0]["id"],
        "personId": persons[0]["id"],
    }
    apply({"identityEdits": [identity]})
    user = session.user.get("Id", session.user.get("id"))

    def favorite(record: str) -> bool:
        item = session.call("/Users/" + user + "/Items/" + record)
        data = item.get("UserData", item.get("userData"))
        return bool(data.get("IsFavorite", data.get("isFavorite")))

    session.call("/Users/" + user + "/FavoriteItems/" + identity["artistId"], "POST")
    assert favorite(identity["artistId"]) and favorite(identity["personId"])
    session.call("/Users/" + user + "/FavoriteItems/" + identity["personId"], "DELETE")
    assert not favorite(identity["artistId"]) and not favorite(identity["personId"])
    # Referenced identity representatives are protected from orphan cleanup.
    expect_rejected(
        lambda: endpoint(
            session, "preview", "POST", {"cleanupIds": [identity["artistId"]]}
        )
    )
    wait_for(
        "identity leaves native credits unchanged",
        lambda: endpoint(session, "items"),
        lambda rows: (
            next(row for row in rows if row["id"] == track["id"])["values"]["artists"]
            == track["values"]["artists"]
        ),
    )
