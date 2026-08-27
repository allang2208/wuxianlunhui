"""Remove the accepted source-angle rotor while retaining the Klein station body.

The authored Blender rotor mask identifies the only area borrowed from the
previous accepted rotor-free body. Everywhere else the approved Klein RGBA
panel remains byte-for-byte the visual source.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("panel_source", type=Path)
    parser.add_argument("rotor_free_fill", type=Path)
    parser.add_argument("rotor_mask", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--dilate", type=int, default=15)
    parser.add_argument("--feather", type=float, default=1.25)
    parser.add_argument("--hub-clear-radius", type=int, default=0,
                        help="also replace a circular source-rotor safety region around the authored hub")
    parser.add_argument("--hub-clear-max-y", type=int,
                        help="clip the circular safety region above this source-space Y coordinate")
    args = parser.parse_args()

    panel = Image.open(args.panel_source).convert("RGBA")
    fill = Image.open(args.rotor_free_fill).convert("RGBA")
    rotor_mask = Image.open(args.rotor_mask).convert("RGBA")
    if panel.size != (1024, 1024) or fill.size != panel.size or rotor_mask.size != panel.size:
        raise SystemExit(
            f"all wind source layers must remain 1024x1024: "
            f"panel={panel.size} fill={fill.size} mask={rotor_mask.size}")

    mask = ImageChops.multiply(rotor_mask.getchannel("R"), rotor_mask.getchannel("A"))
    if args.hub_clear_radius > 0:
        mask_values = np.asarray(mask, dtype=np.uint8)
        ys, xs = np.where(mask_values > 96)
        if not len(xs):
            raise SystemExit("authored rotor mask has no visible hub/rotor pixels")
        hub_x = round((int(xs.min()) + int(xs.max()) + 1) / 2)
        hub_y = round((int(ys.min()) + int(ys.max()) + 1) / 2)
        safety = Image.new("L", panel.size, 0)
        radius = int(args.hub_clear_radius)
        ImageDraw.Draw(safety).ellipse(
            (hub_x - radius, hub_y - radius, hub_x + radius, hub_y + radius), fill=255)
        if args.hub_clear_max_y is not None:
            ImageDraw.Draw(safety).rectangle(
                (0, int(args.hub_clear_max_y), panel.width, panel.height), fill=0)
        mask = ImageChops.lighter(mask, safety)
    dilate = max(1, int(args.dilate))
    if dilate % 2 == 0:
        dilate += 1
    mask = mask.filter(ImageFilter.MaxFilter(dilate))
    if args.feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(float(args.feather)))

    body = Image.composite(fill, panel, mask)
    rgba = np.asarray(body, dtype=np.uint8).copy()
    rgba[rgba[..., 3] == 0, :3] = 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(args.output, optimize=True)

    metadata = {
        "panelSource": str(args.panel_source),
        "rotorFreeFill": str(args.rotor_free_fill),
        "rotorMask": str(args.rotor_mask),
        "output": str(args.output),
        "maskDilate": dilate,
        "maskFeather": float(args.feather),
        "hubClearRadius": int(args.hub_clear_radius),
        "hubClearMaxY": args.hub_clear_max_y,
        "method": "authored Blender rotor mask over accepted rotor-free fill",
    }
    args.output.with_suffix(".json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
