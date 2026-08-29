#!/usr/bin/env python3
"""Finalize the approved bomb-projectile mother into a rotation-safe texture."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
SOURCE = ROOT / "bomb-projectile-mother-v01.png"
FINAL = ROOT / "bomb-projectile-256.png"
PREVIEW = ROOT / "bomb-projectile-256-checker.png"
RUNTIME = REPO / "assets" / "enemies" / "bomb_zombie" / "projectile.png"
MANIFEST = ROOT / "projectile-manifest.json"

CANVAS = 256
CONTENT_LONG_EDGE = 224
ALPHA_CUTOFF = 8
MIN_COMPONENT_PIXELS = 64


def resize_premultiplied(rgba: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Resize RGBA without dark fringes around the transparent silhouette."""
    alpha = rgba[..., 3].astype(np.float32) / 255.0
    premultiplied = rgba[..., :3].astype(np.float32) * alpha[..., None]
    resized_alpha = np.asarray(
        Image.fromarray(alpha, "F").resize(size, Image.Resampling.LANCZOS),
        dtype=np.float32,
    )
    resized_premultiplied = np.stack(
        [
            np.asarray(
                Image.fromarray(premultiplied[..., channel], "F").resize(
                    size, Image.Resampling.LANCZOS
                ),
                dtype=np.float32,
            )
            for channel in range(3)
        ],
        axis=2,
    )
    visible = resized_alpha > 1e-4
    rgb = np.zeros_like(resized_premultiplied)
    rgb[visible] = resized_premultiplied[visible] / resized_alpha[visible, None]
    out = np.dstack(
        [
            np.clip(rgb, 0, 255).astype(np.uint8),
            np.clip(resized_alpha * 255.0, 0, 255).astype(np.uint8),
        ]
    )
    out[out[..., 3] == 0, :3] = 0
    return out


def checker_preview(rgba: np.ndarray) -> np.ndarray:
    yy, xx = np.indices((CANVAS, CANVAS))
    shade = np.where(((xx // 16 + yy // 16) % 2)[..., None], 62, 88)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = rgba[..., 3:4].astype(np.float32) / 255.0
    return np.clip(
        rgba[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha),
        0,
        255,
    ).astype(np.uint8)


def main() -> None:
    source = np.asarray(Image.open(SOURCE).convert("RGBA")).copy()
    source[source[..., 3] <= ALPHA_CUTOFF, 3] = 0

    foreground = (source[..., 3] > 0).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    keep = np.zeros(foreground.shape, dtype=bool)
    kept_components = 0
    for label in range(1, count):
        if int(stats[label, cv2.CC_STAT_AREA]) >= MIN_COMPONENT_PIXELS:
            keep |= labels == label
            kept_components += 1
    if not keep.any():
        raise RuntimeError("Projectile alpha contains no retained component")
    source[~keep, 3] = 0
    source[source[..., 3] == 0, :3] = 0

    ys, xs = np.where(source[..., 3] > 0)
    x0, y0 = int(xs.min()), int(ys.min())
    x1, y1 = int(xs.max()) + 1, int(ys.max()) + 1
    crop = source[y0:y1, x0:x1]
    scale = CONTENT_LONG_EDGE / max(crop.shape[1], crop.shape[0])
    target_size = (
        max(1, round(crop.shape[1] * scale)),
        max(1, round(crop.shape[0] * scale)),
    )
    resized = resize_premultiplied(crop, target_size)
    cell = np.zeros((CANVAS, CANVAS, 4), dtype=np.uint8)
    offset_x = (CANVAS - target_size[0]) // 2
    offset_y = (CANVAS - target_size[1]) // 2
    cell[
        offset_y:offset_y + target_size[1],
        offset_x:offset_x + target_size[0],
    ] = resized
    cell[cell[..., 3] == 0, :3] = 0

    FINAL.parent.mkdir(parents=True, exist_ok=True)
    RUNTIME.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(cell, "RGBA").save(FINAL, optimize=True, compress_level=9)
    Image.fromarray(cell, "RGBA").save(RUNTIME, optimize=True, compress_level=9)
    preview = Image.fromarray(checker_preview(cell), "RGB").resize(
        (512, 512), Image.Resampling.NEAREST
    )
    preview.save(PREVIEW, optimize=True)

    final_alpha = cell[..., 3]
    final_ys, final_xs = np.where(final_alpha > 0)
    report = {
        "assetOnly": False,
        "runtimeIntegrationActive": True,
        "generator": "built-in imagegen",
        "source": SOURCE.name,
        "prompt": "prompt-v01.txt",
        "referenceImages": [
            "../mother/bomb-zombie-mother-v02-empty-hand.png",
            "attacking-release-reference-f080.png",
            "assets/terrain/abandoned-mine-props/abandoned_mine_prop_dynamite.png",
        ],
        "output": FINAL.name,
        "runtimeCandidate": "assets/enemies/bomb_zombie/projectile.png",
        "canvas": [CANVAS, CANVAS],
        "contentLongEdge": CONTENT_LONG_EDGE,
        "contentBBox": [
            int(final_xs.min()),
            int(final_ys.min()),
            int(final_xs.max()),
            int(final_ys.max()),
        ],
        "keptComponents": kept_components,
        "componentContract": "one dynamite bundle plus two deliberate fuse sparks",
        "transparentRgbNonzero": int(
            np.count_nonzero(cell[..., :3][final_alpha == 0])
        ),
        "edgeTouch": bool(
            (final_alpha[0] > 0).any()
            or (final_alpha[-1] > 0).any()
            or (final_alpha[:, 0] > 0).any()
            or (final_alpha[:, -1] > 0).any()
        ),
        "futureRuntimeContract": {
            "rotation": "runtime",
            "trajectory": "runtime parabolic throw",
            "landingFuseMs": 2000,
            "explosion": "runtime",
        },
    }
    MANIFEST.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
