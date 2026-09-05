#!/usr/bin/env python3
"""Rebuild the accepted abandoned-mine continuous floor.

Walls and the lift gate are owned by build-mine-wall-pbr-kit-v2.py and
install-mine-wall-pbr-kit-v2.py. This script deliberately has no wall/gate
outputs, so rerunning the floor pipeline cannot overwrite modeled assets.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "tools" / "ai-gen" / "_abandoned_mine_20260828"
ASSET_DIR = ROOT / "assets" / "terrain"
FLOOR_SOURCE = SOURCE_DIR / "floor-source-imagegen.png"
FLOOR_OUTPUT = ASSET_DIR / "floor_abandoned_mine_seamless.png"
MANIFEST_OUTPUT = SOURCE_DIR / "manifest.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_floor() -> tuple[Image.Image, dict[str, int]]:
    source = Image.open(FLOOR_SOURCE).convert("RGB").resize(
        (1024, 1024), Image.Resampling.LANCZOS
    )
    source = ImageEnhance.Color(source).enhance(0.58)
    data = np.asarray(source, dtype=np.float64)
    height, width = data.shape[:2]
    rolled = np.roll(data, (height // 2, width // 2), axis=(0, 1))
    yy, xx = np.mgrid[0:height, 0:width]
    mx = np.minimum(xx, width - 1 - xx) / (width / 2)
    my = np.minimum(yy, height - 1 - yy) / (height / 2)
    weight = np.clip(np.minimum(mx, my), 0, 1)
    weight = weight * weight * (3 - 2 * weight)
    seamless = np.clip(
        data * weight[..., None] + rolled * (1 - weight[..., None]), 0, 255
    ).astype(np.uint8)

    # Runtime contract: the first/last row and column are exactly equal.
    seamless[:, -1, :] = seamless[:, 0, :]
    seamless[-1, :, :] = seamless[0, :, :]
    floor = Image.fromarray(seamless, "RGB")
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    floor.save(FLOOR_OUTPUT, optimize=True)
    return floor, {
        "horizontalMaxRgbDelta": int(
            np.abs(seamless[:, 0, :].astype(int) - seamless[:, -1, :].astype(int)).max()
        ),
        "verticalMaxRgbDelta": int(
            np.abs(seamless[0, :, :].astype(int) - seamless[-1, :, :].astype(int)).max()
        ),
    }


def main() -> None:
    if not FLOOR_SOURCE.exists():
        raise FileNotFoundError(f"missing ImageGen floor source: {FLOOR_SOURCE}")
    floor, seam = build_floor()
    manifest = {
        "version": 2,
        "pipeline": "ImageGen floor source -> deterministic two-axis seamless runtime floor",
        "sourceTool": "built-in image_gen",
        "sources": [str(FLOOR_SOURCE.relative_to(ROOT)).replace("\\", "/")],
        "runtime": {
            "floor_abandoned_mine_seamless": {
                "path": str(FLOOR_OUTPUT.relative_to(ROOT)).replace("\\", "/"),
                "size": list(floor.size),
                "runtimeTextureScaleY": 0.5774,
                "seam": seam,
                "sha256": sha256(FLOOR_OUTPUT),
            }
        },
        "modeledWallKit": "tools/ai-gen/_mine_wall_pbr_kit_v2_20260830/manifest.json",
    }
    MANIFEST_OUTPUT.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
