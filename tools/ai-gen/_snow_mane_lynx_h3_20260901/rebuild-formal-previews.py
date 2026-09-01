#!/usr/bin/env python3
"""Rebuild final GIF/contact previews without changing formal runtime atlases."""

from __future__ import annotations

import json
import runpy
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
BUILD = runpy.run_path(str(ROOT / "build-formal-sheets.py"))
extract_cells = BUILD["extract_cells"]
write_previews = BUILD["write_previews"]


def main() -> None:
    manifest_path = ROOT / "sprite-sheet-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for action, entry in manifest["actions"].items():
        cells = extract_cells(
            ROOT / entry["finalSheet"],
            entry["frameWidth"],
            entry["frameHeight"],
            entry["frameCount"],
            entry["columns"],
        )
        gif, contact, timing = write_previews(action, cells, entry["durationMs"])
        with Image.open(gif) as preview:
            preview_size = list(preview.size)
        expected = [entry["frameWidth"], entry["frameHeight"]]
        if preview_size != expected:
            raise RuntimeError(f"{action}: preview {preview_size} != runtime cell {expected}")
        entry["gifTimingMs"] = timing
        entry["validation"]["previewFrameSize"] = preview_size
        entry["validation"]["previewPreservesRuntimeAspect"] = True
        print(f"[lynx-preview] {action}: {preview_size[0]}x{preview_size[1]} -> {gif}")
        print(f"[lynx-preview] {action}: contact -> {contact}")
    correction = manifest.setdefault("previewAspectCorrection", {})
    correction["reason"] = "removed fixed 384x240 preview resize that distorted non-384px-wide cells"
    correction.setdefault("runtimeAtlasesRegenerated", False)
    correction.setdefault("sourceVideosRegenerated", False)
    correction["previewsRegenerated"] = True
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
