#!/usr/bin/env python3
"""Repair RIFE-only red/magenta blocks in existing formal outputs."""

from __future__ import annotations

import json
import runpy
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
BUILD = runpy.run_path(str(ROOT / "build-formal-sheets.py"))
extract_cells = BUILD["extract_cells"]
compose = BUILD["compose"]
repair = BUILD["repair_odd_red_chroma"]
write_previews = BUILD["write_previews"]
validate = BUILD["validate"]
HOLD_FALLBACKS = {
    # Attack intentionally has no held-frame fallback: the previous five holds
    # visibly repeated poses. Its rebuilt source window is short and uniform.
    "attack": {},
    "death": {9: 10},
}


def clear_large_odd_chroma(cells: list[np.ndarray]) -> list[int]:
    """Drop large saturated red/magenta RIFE ghosts; even source keys are untouched."""
    cleared = []
    for index, frame in enumerate(cells):
        if index % 2 == 0:
            cleared.append(0)
            continue
        rgb = frame[..., :3].astype(np.int16)
        alpha = frame[..., 3]
        red = ((alpha > 0) & (rgb[..., 0] > rgb[..., 1] + 25)
               & (rgb[..., 0] > rgb[..., 2] + 15))
        magenta = ((alpha > 0) & (rgb[..., 0] > rgb[..., 1] + 20)
                   & (rgb[..., 2] > rgb[..., 1] + 8))
        labels, count = ndimage.label(red | magenta)
        remove = np.zeros_like(alpha, dtype=bool)
        for label in range(1, count + 1):
            component = labels == label
            if int(component.sum()) >= 20:
                remove |= component
        if remove.any():
            saturated = (alpha > 0) & ((rgb.max(axis=2) - rgb.min(axis=2)) > 20)
            remove = ndimage.binary_dilation(remove, iterations=1) & saturated
            frame[remove] = 0
        cleared.append(int(remove.sum()))
    return cleared


def main() -> None:
    manifest_path = ROOT / "sprite-sheet-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for action, entry in manifest["actions"].items():
        sheet_path = ROOT / entry["finalSheet"]
        cells = extract_cells(
            sheet_path,
            entry["frameWidth"],
            entry["frameHeight"],
            entry["frameCount"],
            entry["columns"],
        )
        repaired = repair(cells)
        # Attack now uses unique native H3 half-step poses for fast-strike
        # fallbacks, so it must not receive this legacy generated-frame scrub.
        cleared = clear_large_odd_chroma(cells) if action == "death" else [0] * len(cells)
        held = []
        for target, source in HOLD_FALLBACKS.get(action, {}).items():
            cells[target] = cells[source].copy()
            held.append({"outputFrame": target, "sourceFrame": source})
        Image.fromarray(compose(cells, entry["columns"]), "RGBA").save(
            sheet_path, optimize=True, compress_level=9
        )
        _gif, _contact, timing = write_previews(action, cells, entry["durationMs"])
        result = validate(cells)
        result["originalKeyFramesPreservedAtEvenIndices"] = True
        result["oddFrameRedOrMagentaPixelsRepairedFinalPass"] = repaired
        result["oddFrameLargeChromaPixelsClearedFinalPass"] = cleared
        result["assetSpecificHeldFrameFallbacks"] = held
        entry["validation"].update(result)
        entry["gifTimingMs"] = timing
        entry["pngBytes"] = sheet_path.stat().st_size
        print(f"[lynx-chroma] {action}: repaired={sum(repaired)} cleared={sum(cleared)}", flush=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
