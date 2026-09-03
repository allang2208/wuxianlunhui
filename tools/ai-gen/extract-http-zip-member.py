#!/usr/bin/env python3
"""List or extract one ZIP member over HTTP range requests.

This avoids downloading multi-gigabyte audio bundles when the host supports
byte ranges. It intentionally selects one exact member and refuses ambiguous
matches.
"""

from __future__ import annotations

import argparse
import io
import shutil
import urllib.request
import zipfile
from pathlib import Path


class HttpRangeReader(io.RawIOBase):
    def __init__(self, url: str) -> None:
        self.url = url
        self.position = 0
        request = urllib.request.Request(url, headers={"Range": "bytes=0-0"})
        with urllib.request.urlopen(request, timeout=60) as response:
            content_range = response.headers.get("Content-Range", "")
        try:
            self.size = int(content_range.rsplit("/", 1)[1])
        except (IndexError, ValueError) as exc:
            raise RuntimeError(f"Server did not return a usable Content-Range: {content_range!r}") from exc

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            position = offset
        elif whence == io.SEEK_CUR:
            position = self.position + offset
        elif whence == io.SEEK_END:
            position = self.size + offset
        else:
            raise ValueError(f"Unsupported whence: {whence}")
        if position < 0:
            raise ValueError("Negative seek position")
        self.position = min(position, self.size)
        return self.position

    def read(self, size: int = -1) -> bytes:
        if self.position >= self.size:
            return b""
        if size is None or size < 0:
            end = self.size - 1
        else:
            end = min(self.size - 1, self.position + size - 1)
        if end < self.position:
            return b""
        request = urllib.request.Request(
            self.url,
            headers={"Range": f"bytes={self.position}-{end}"},
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
        self.position += len(data)
        return data


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--contains", required=True, help="Case-insensitive member-name substring")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    reader = HttpRangeReader(args.url)
    with zipfile.ZipFile(reader) as archive:
        needle = args.contains.casefold()
        matches = [name for name in archive.namelist() if needle in name.casefold()]
        for name in matches:
            info = archive.getinfo(name)
            print(f"{info.file_size}\t{name}")
        if args.output is None:
            return
        if len(matches) != 1:
            raise RuntimeError(f"Expected exactly one match, found {len(matches)}")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(matches[0]) as source, args.output.open("wb") as target:
            shutil.copyfileobj(source, target)
        print(args.output.resolve())


if __name__ == "__main__":
    main()
