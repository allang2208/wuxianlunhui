#!/usr/bin/env python3
"""Constrain a keyed building body to its deterministic Blender depth silhouette."""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage


def parse_args():
    parser = argparse.ArgumentParser(description="Apply a Blender depth silhouette as an alpha limit.")
    parser.add_argument("body", type=Path)
    parser.add_argument("depth", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--edge-pad", type=int, default=3,
                        help="small mask dilation in px to retain anti-aliased architectural edges")
    parser.add_argument("--post-scale", type=float, default=1.0,
                        help="scale the masked body around its ground contact; useful for 1x1 review assets")
    parser.add_argument("--min-component-pixels", type=int, default=0,
                        help="remove isolated alpha components smaller than this many output pixels")
    parser.add_argument("--restore-modeled-alpha", action="store_true",
                        help="restore keyed-away RGB well inside the authored depth silhouette")
    parser.add_argument("--restore-erode", type=int, default=2,
                        help="source-pixel inset used by --restore-modeled-alpha")
    parser.add_argument("--restore-delta-depth", type=Path,
                        help="restore only silhouette pixels added beyond this generation-control depth")
    parser.add_argument("--restore-max-value", type=int, default=220,
                        help="do not restore keyed hidden RGB brighter than this channel value")
    parser.add_argument("--remove-green-outside-restore", action="store_true",
                        help="remove obvious green-screen spill outside the authored restore region")
    parser.add_argument("--restore-halo", type=int, default=4,
                        help="source-pixel halo around the authored restore region allowed to retain green detail")
    return parser.parse_args()


def main():
    args = parse_args()
    body = Image.open(args.body).convert("RGBA")
    depth = Image.open(args.depth).convert("RGBA")
    if body.size != depth.size:
        raise SystemExit(f"size mismatch: body={body.size}, depth={depth.size}")
    depth_rgb = np.asarray(depth)[..., :3]
    base_mask_array = depth_rgb.max(axis=2) > 4
    mask = Image.fromarray(base_mask_array.astype(np.uint8) * 255, "L")
    if args.edge_pad > 0:
        mask = mask.filter(ImageFilter.MaxFilter(args.edge_pad * 2 + 1))
    rgba = np.asarray(body).copy()
    rgba[..., 3] = np.minimum(rgba[..., 3], np.asarray(mask))
    restored_pixels = 0
    restore_seed = None
    if args.restore_modeled_alpha:
        restore_seed = base_mask_array
        if args.restore_delta_depth:
            delta_depth = Image.open(args.restore_delta_depth).convert("RGBA")
            if delta_depth.size != depth.size:
                raise SystemExit(f"restore delta size mismatch: delta={delta_depth.size} depth={depth.size}")
            delta_rgb = np.asarray(delta_depth)[..., :3]
            restore_seed = base_mask_array & ~(delta_rgb.max(axis=2) > 4)
        inset = (ndimage.binary_erosion(
            restore_seed,
            iterations=max(0, int(args.restore_erode)),
            border_value=0,
        ) if int(args.restore_erode) > 0 else restore_seed)
        restore_rgb = rgba[..., :3]
        restored = (inset & (rgba[..., 3] == 0)
                    & (restore_rgb.max(axis=2) <= np.clip(args.restore_max_value, 0, 255)))
        restored_pixels = int(np.count_nonzero(restored))
        rgba[..., 3][restored] = 255
    green_spill_pixels = 0
    if args.remove_green_outside_restore:
        if restore_seed is None:
            raise SystemExit("--remove-green-outside-restore requires --restore-modeled-alpha")
        rgb = rgba[..., :3].astype(np.float32)
        green = ((rgb[..., 1] >= 50.0)
                 & (rgb[..., 1] >= rgb[..., 0] * 1.20)
                 & (rgb[..., 1] >= rgb[..., 2] * 1.20))
        restore_halo = ndimage.binary_dilation(
            restore_seed,
            iterations=max(0, int(args.restore_halo)),
        )
        green_spill = green & ~restore_halo & (rgba[..., 3] > 0)
        green_spill_pixels = int(np.count_nonzero(green_spill))
        rgba[green_spill] = (0, 0, 0, 0)
    if not 0.0 < args.post_scale <= 1.0:
        raise SystemExit("--post-scale must be in (0, 1]")
    if abs(args.post_scale - 1.0) > 1e-9:
        ys, xs = np.where(rgba[..., 3] > 0)
        if len(xs) == 0:
            raise SystemExit("cannot post-scale an empty body")
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        cropped = Image.fromarray(rgba, "RGBA").crop((x0, y0, x1, y1))
        scaled_size = (
            max(1, round(cropped.width * args.post_scale)),
            max(1, round(cropped.height * args.post_scale)),
        )
        cropped = cropped.resize(scaled_size, Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", body.size, (0, 0, 0, 0))
        center_x = (x0 + x1) / 2
        paste_x = round(center_x - cropped.width / 2)
        paste_y = y1 - cropped.height
        canvas.alpha_composite(cropped, (paste_x, paste_y))
        rgba = np.asarray(canvas).copy()
    removed_components = 0
    removed_pixels = 0
    min_component_pixels = max(0, int(args.min_component_pixels))
    if min_component_pixels > 1:
        labels, component_count = ndimage.label(
            rgba[..., 3] > 0,
            structure=np.ones((3, 3), dtype=np.uint8),
        )
        if component_count:
            sizes = np.bincount(labels.ravel())
            small = np.where((sizes < min_component_pixels) & (np.arange(len(sizes)) > 0))[0]
            if len(small):
                remove = np.isin(labels, small)
                removed_components = int(len(small))
                removed_pixels = int(np.count_nonzero(remove))
                rgba[remove] = (0, 0, 0, 0)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(args.out)
    print(f"silhouette alpha={np.count_nonzero(rgba[..., 3]) / rgba[..., 3].size:.1%} "
          f"post_scale={args.post_scale:.3f} removed_components={removed_components} "
          f"removed_pixels={removed_pixels} restored_pixels={restored_pixels} "
          f"green_spill_pixels={green_spill_pixels} -> {args.out}")


if __name__ == "__main__":
    main()
