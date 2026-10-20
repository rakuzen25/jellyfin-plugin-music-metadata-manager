"""Synthetic tagged audio and native metadata correction/restoration contracts."""

import time

from jellyfin_plugin_toolkit.installation import Session


class MusicSession(Session):
    def populate_media(self, media):
        super().populate_media(media)
        import os

        self.docker(
            "run",
            "--rm",
            "--network",
            "none",
            "--user",
            f"{os.getuid()}:{os.getgid()}",
            "--mount",
            f"type=bind,source={media},target=/fixture",
            "--entrypoint",
            "/usr/lib/jellyfin-ffmpeg/ffmpeg",
            self.context.config["host"]["image"],
            "-nostdin",
            "-loglevel",
            "error",
            "-i",
            "/fixture/track.wav",
            "-metadata",
            "title=Original synthetic title",
            "-metadata",
            "artist=Fixture artist",
            "-metadata",
            "album=Fixture album",
            "-metadata",
            "comment=Unrelated fixture comment",
            "-c:a",
            "flac",
            "/fixture/track.flac",
        )
        (media / "track.wav").unlink()


def wait_for(description, read, predicate, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = read()
        if predicate(value):
            return value
        time.sleep(0.25)
    raise AssertionError(description + " did not settle: " + repr(value))


def characterize_media(session, endpoint):
    session.call("/Library/Refresh", "POST")
    rows = wait_for(
        "synthetic music scan",
        lambda: endpoint(session, "items"),
        lambda rows: any(
            row["path"] == "/fixture-media/track.flac"
            and row["values"]["title"] == "Original synthetic title"
            for row in rows
        ),
    )
    track = next(
        row
        for row in rows
        if row["path"] == "/fixture-media/track.flac"
        and row["values"]["title"] == "Original synthetic title"
    )
    assert track["values"]["title"] == "Original synthetic title", track
    baseline = track["values"].copy()

    def current():
        return next(
            row for row in endpoint(session, "items") if row["id"] == track["id"]
        )["values"]

    return track, baseline, current
