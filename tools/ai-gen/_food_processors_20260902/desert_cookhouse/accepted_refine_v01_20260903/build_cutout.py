#!/usr/bin/env python3
"""Rebuild the accepted desert cookhouse cutout from the selected raw image.

The Blender full-depth silhouette is the authority for removing the generated
external cast shadow.  Alpha is never repaired from broad colour thresholds:
the final RGB-only spill pass is limited to four pixels inside the accepted
silhouette so sand, adobe and dark contact occlusion remain intact.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
AI_GEN = REPO / "tools" / "ai-gen"
SOURCE = HERE.parent / "candidates_dev_s12_v01" / "desert_cookhouse" / "desert_cookhouse_refine_v01_raw.png"
DEPTH = HERE.parent / "desert_cookhouse_depth.png"

KEYED = HERE / "desert_cookhouse_keyed_soft45_105.png"
KEYED_REVIEW = HERE / "desert_cookhouse_keyed_soft45_105_review.png"
MASKED = HERE / "desert_cookhouse_shadow_removed_full.png"
EDGE_CLEAN = HERE / "desert_cookhouse_edge_clean_full.png"
FINAL = HERE / "desert_cookhouse_cutout.png"
FINAL_METADATA = HERE / "desert_cookhouse_cutout_metadata.json"
ALPHA_REVIEW = HERE / "desert_cookhouse_alpha_review.png"
PRODUCTION_RECORD = HERE / "production-record.json"


def run(*args: object) -> None:
    command = [sys.executable, *(str(value) for value in args)]
    subprocess.run(command, cwd=REPO, check=True)


def make_alpha_review() -> None:
    subject = Image.open(FINAL).convert("RGBA")
    cell = 24
    checker = Image.new("RGB", subject.size, (0, 0, 0))
    draw = ImageDraw.Draw(checker)
    colours = ((79, 84, 91), (126, 132, 140))
    for y in range(0, subject.height, cell):
        for x in range(0, subject.width, cell):
            draw.rectangle(
                (x, y, min(x + cell - 1, subject.width - 1), min(y + cell - 1, subject.height - 1)),
                fill=colours[((x // cell) + (y // cell)) & 1],
            )
    review = Image.alpha_composite(checker.convert("RGBA"), subject)
    review.save(ALPHA_REVIEW, optimize=True)


def alpha_report() -> dict[str, object]:
    rgba = np.asarray(Image.open(FINAL).convert("RGBA"), dtype=np.uint8)
    alpha = rgba[..., 3]
    visible = alpha > 0
    labels, component_count = ndimage.label(visible, structure=np.ones((3, 3), dtype=np.uint8))
    component_sizes = np.bincount(labels.ravel())[1:]
    ys, xs = np.where(visible)
    hidden_rgb_nonzero = int(np.count_nonzero(np.any(rgba[..., :3][~visible] != 0, axis=1)))
    return {
        "mode": "RGBA",
        "fileSize": [int(rgba.shape[1]), int(rgba.shape[0])],
        "alphaExtrema": [int(alpha.min()), int(alpha.max())],
        "alphaBBox": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
        "visiblePixels": int(np.count_nonzero(visible)),
        "transparentPixels": int(np.count_nonzero(~visible)),
        "connectedComponents": int(component_count),
        "largestComponentPixels": int(component_sizes.max()) if len(component_sizes) else 0,
        "transparentPixelsWithRgb": hidden_rgb_nonzero,
    }


def main() -> None:
    for required in (SOURCE, DEPTH):
        if not required.is_file():
            raise SystemExit(f"missing required input: {required}")

    run(
        AI_GEN / "key-world122-building-body.py",
        SOURCE,
        KEYED,
        "--soft-key-inner", 45,
        "--soft-key-outer", 105,
        "--nearest-opaque-edge-rgb",
        "--preview", KEYED_REVIEW,
    )
    run(
        AI_GEN / "mask-world122-building-body.py",
        KEYED,
        DEPTH,
        MASKED,
        "--edge-pad", 0,
    )
    run(
        AI_GEN / "repair-local-green-spill.py",
        MASKED,
        EDGE_CLEAN,
        "--rect", "0,0,1024,1024",
        "--min-green", 0,
        "--green-margin", 1,
        "--min-alpha", 1,
        "--max-edge-distance", 4,
    )
    run(
        AI_GEN / "finalize-building-runtime.py",
        EDGE_CLEAN,
        FINAL,
        "--display-width", 768,
        "--padding", 4,
        "--preserve-alpha-exact",
        "--nearest-opaque-edge-rgb",
        "--defringe-inner-pixels", 6,
        "--metadata", FINAL_METADATA,
    )
    make_alpha_review()

    report = alpha_report()
    record = {
        "asset": "desert_cookhouse",
        "displayName": "沙地炊坊",
        "selection": "refine_v01 selected by the user on 2026-09-03",
        "source": SOURCE.relative_to(REPO).as_posix(),
        "depthAuthority": DEPTH.relative_to(REPO).as_posix(),
        "output": FINAL.relative_to(REPO).as_posix(),
        "review": ALPHA_REVIEW.relative_to(REPO).as_posix(),
        "shadowPolicy": {
            "removed": "generated external cast shadow and green shadow tail outside the authored full-depth silhouette",
            "retained": "narrow internal contact occlusion beneath eaves, ovens, canopy posts and the foundation",
            "alphaAuthority": "edge-pad 0 full-depth silhouette; no broad HSV alpha deletion",
        },
        "pipeline": [
            {"tool": "key-world122-building-body.py", "softKey": [45, 105], "nearestOpaqueEdgeRgb": True},
            {"tool": "mask-world122-building-body.py", "edgePad": 0},
            {"tool": "repair-local-green-spill.py", "rgbOnly": True, "maxEdgeDistance": 4},
            {"tool": "finalize-building-runtime.py", "displayWidth": 768, "padding": 4, "preserveAlphaExact": True, "defringeInnerPixels": 6},
        ],
        "staticAlphaInspection": report,
        "runtimeIntegrationActive": True,
        "validationBoundary": "offline cutout and alpha inspection only; no game/runtime test",
    }
    PRODUCTION_RECORD.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(record, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
