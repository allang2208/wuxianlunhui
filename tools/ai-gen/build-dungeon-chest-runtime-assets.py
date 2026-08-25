#!/usr/bin/env python3
"""Build the accepted dungeon chest states into runtime-sized RGBA assets."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image


REPO = Path(__file__).resolve().parents[2]
PACK = REPO / "tools/ai-gen/_settlement_building_pack_20260821"
ASSETS = {
    "closed": {
        "source": PACK / "dungeon_chest_closed/dungeon_chest_closed_refine_v02_body_islands_cleaned.png",
        "output": REPO / "assets/terrain/chest_closed.png",
        "display_width": 192,
        "origin": [0.5, 0.75],
        "base_span": 408,
    },
    "opened": {
        "source": PACK / "dungeon_chest_open/dungeon_chest_open_refine_v02_body_seam_cleaned.png",
        "output": REPO / "assets/terrain/chest_opened.png",
        "display_width": 241,
        "origin": [0.5, 0.78015],
        "base_span": 325,
    },
}
METADATA = PACK / "dungeon_chest_runtime_metadata.json"
RUNTIME_SIZE = (512, 512)


def resize_premultiplied(image: Image.Image) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float32)
    alpha = rgba[:, :, 3:4] / 255.0
    premultiplied = rgba[:, :, :3] * alpha

    premul_image = Image.fromarray(np.clip(premultiplied, 0, 255).astype(np.uint8), "RGB")
    alpha_image = Image.fromarray(np.clip(alpha[:, :, 0] * 255, 0, 255).astype(np.uint8), "L")
    premul_small = np.asarray(premul_image.resize(RUNTIME_SIZE, Image.Resampling.LANCZOS), dtype=np.float32)
    alpha_small = np.asarray(alpha_image.resize(RUNTIME_SIZE, Image.Resampling.LANCZOS), dtype=np.float32)

    out_rgb = np.zeros_like(premul_small, dtype=np.float32)
    visible = alpha_small > 0
    out_rgb[visible] = premul_small[visible] * (255.0 / alpha_small[visible][:, None])
    out = np.dstack((np.clip(out_rgb, 0, 255), np.clip(alpha_small, 0, 255))).astype(np.uint8)
    out[alpha_small == 0, :3] = 0
    return Image.fromarray(out, "RGBA")


def alpha_stats(image: Image.Image) -> dict[str, object]:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    mask = rgba[:, :, 3] > 16
    ys, xs = np.where(mask)
    if not len(xs):
        raise SystemExit("runtime chest output has no visible alpha content")
    touches_border = bool(mask[0].any() or mask[-1].any() or mask[:, 0].any() or mask[:, -1].any())
    if touches_border:
        raise SystemExit("runtime chest alpha content touches the canvas border")
    return {
        "size": [image.width, image.height],
        "alphaBbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
        "alphaPixels": int(mask.sum()),
        "touchesBorder": touches_border,
    }


def main() -> None:
    records: dict[str, object] = {}
    for state, spec in ASSETS.items():
        source: Path = spec["source"]
        output: Path = spec["output"]
        if not source.exists():
            raise FileNotFoundError(source)
        runtime = resize_premultiplied(Image.open(source))
        output.parent.mkdir(parents=True, exist_ok=True)
        runtime.save(output, optimize=True)
        stats = alpha_stats(runtime)
        display_width = int(spec["display_width"])
        origin = list(spec["origin"])
        display_height = display_width * (runtime.height / runtime.width)
        visible_bottom_offset_y = (stats["alphaBbox"][3] / runtime.height - origin[1]) * display_height
        records[state] = {
            "source": source.relative_to(REPO).as_posix(),
            "output": output.relative_to(REPO).as_posix(),
            "displayWidth": display_width,
            "origin": origin,
            "baseSpanSourcePx": int(spec["base_span"]),
            "visibleBottomOffsetY": round(visible_bottom_offset_y, 3),
            **stats,
        }
        print(f"{state}: {source.relative_to(REPO)} -> {output.relative_to(REPO)}")

    metadata = {
        "pipeline": "dungeon-chest-two-state-runtime",
        "layout": "per-state display width normalizes lower chest body; per-state origin locks visible bottom",
        "transition": "single-sprite fade-out, texture swap, fade-in",
        "states": records,
    }
    METADATA.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"metadata -> {METADATA.relative_to(REPO)}")


if __name__ == "__main__":
    main()
