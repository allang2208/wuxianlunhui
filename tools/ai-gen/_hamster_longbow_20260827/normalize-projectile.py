"""Clean and normalize the approved longbow projectile source.

This is a deterministic asset-processing step, not a generative edit. It keeps
the source geometry and colors, removes extraction fringe colors, strengthens
the alpha interior, and emits a 512x512 runtime-ready texture whose visible
content is 448 pixels wide.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def _largest_component(mask: np.ndarray) -> np.ndarray:
    labels, count = ndimage.label(mask)
    if count == 0:
        raise ValueError("source has no visible alpha content")
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    return labels == sizes.argmax()


def _clean_rgba(source: Image.Image) -> Image.Image:
    rgba = np.asarray(source.convert("RGBA"), dtype=np.uint8).copy()
    alpha = rgba[..., 3]

    visible = _largest_component(alpha >= 8)
    core = visible & (alpha >= 224)
    if not core.any():
        raise ValueError("source has no high-confidence opaque interior")

    # Copy the nearest high-confidence foreground color into fringe pixels.
    # This prevents red/green RGB contamination from leaking through filtering.
    _, nearest = ndimage.distance_transform_edt(~core, return_indices=True)
    fringe = visible & ~core
    rgba[..., :3][fringe] = rgba[nearest[0][fringe], nearest[1][fringe], :3]

    clean_alpha = np.zeros_like(alpha)
    clean_alpha[visible] = alpha[visible]
    clean_alpha[core] = 255
    clean_alpha[(clean_alpha > 0) & (clean_alpha < 16)] = 0
    rgba[..., 3] = clean_alpha
    rgba[clean_alpha == 0, :3] = 0
    return Image.fromarray(rgba, "RGBA")


def _resize_premultiplied(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    rgba = np.asarray(image, dtype=np.float32)
    alpha = rgba[..., 3:4] / 255.0
    premultiplied = np.concatenate((rgba[..., :3] * alpha, rgba[..., 3:4]), axis=2)
    resized_channels = [
        np.asarray(
            Image.fromarray(np.clip(premultiplied[..., i], 0, 255).astype(np.uint8), "L").resize(
                size, Image.Resampling.LANCZOS
            ),
            dtype=np.float32,
        )
        for i in range(4)
    ]
    resized = np.stack(resized_channels, axis=2)
    out_alpha = resized[..., 3:4]
    out_rgb = np.divide(
        resized[..., :3] * 255.0,
        out_alpha,
        out=np.zeros_like(resized[..., :3]),
        where=out_alpha > 0,
    )
    out = np.concatenate((out_rgb, out_alpha), axis=2)
    out = np.clip(out, 0, 255).astype(np.uint8)
    out[out[..., 3] < 8] = 0
    out[..., 3][out[..., 3] >= 248] = 255
    out[out[..., 3] == 0, :3] = 0
    return Image.fromarray(out, "RGBA")


def normalize(source_path: Path, clean_path: Path, output_path: Path, report_path: Path) -> None:
    source = Image.open(source_path).convert("RGBA")
    clean = _clean_rgba(source)
    clean_path.parent.mkdir(parents=True, exist_ok=True)
    clean.save(clean_path)

    alpha = np.asarray(clean.getchannel("A"))
    ys, xs = np.where(alpha > 0)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    crop = clean.crop(bbox)

    target_width = 448
    target_height = max(1, round(crop.height * target_width / crop.width))
    resized = _resize_premultiplied(crop, (target_width, target_height))
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    offset = ((512 - target_width) // 2, (512 - target_height) // 2)
    canvas.alpha_composite(resized, offset)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path)

    out = np.asarray(canvas)
    out_alpha = out[..., 3]
    out_ys, out_xs = np.where(out_alpha > 0)
    out_bbox = [
        int(out_xs.min()),
        int(out_ys.min()),
        int(out_xs.max()) + 1,
        int(out_ys.max()) + 1,
    ]
    report = {
        "source": source_path.as_posix(),
        "cleanSource": clean_path.as_posix(),
        "output": output_path.as_posix(),
        "canvasSize": [512, 512],
        "sourceContentBounds": list(bbox),
        "outputContentBounds": out_bbox,
        "projectileContentWidth": out_bbox[2] - out_bbox[0],
        "projectileTipDirection": "right",
        "transparentPixelCount": int((out_alpha == 0).sum()),
        "semiTransparentPixelCount": int(((out_alpha > 0) & (out_alpha < 255)).sum()),
        "opaquePixelCount": int((out_alpha == 255).sum()),
        "transparentRgbNonzeroPixelCount": int(np.any(out[..., :3][out_alpha == 0] != 0, axis=1).sum()),
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("clean_source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    normalize(args.source, args.clean_source, args.output, args.report)


if __name__ == "__main__":
    main()
