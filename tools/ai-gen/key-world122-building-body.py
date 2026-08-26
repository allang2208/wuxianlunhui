#!/usr/bin/env python3
"""Remove the deliberately uniform chroma-key backdrop from a World-122 body render.

Unlike the generic transparent cutout route, the default mode keeps only the
background connected to the canvas edge, so green/blue stained glass inside
the building cannot be mistaken for background. Assets known to contain no
intentional green can opt into full-canvas chroma cleanup.
"""

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def parse_args():
    parser = argparse.ArgumentParser(description="Chroma-key a World-122 building body render.")
    parser.add_argument("src", type=Path)
    parser.add_argument("dst", type=Path)
    parser.add_argument("--threshold", type=float, default=128.0,
                        help="RGB distance from the corner background accepted as backdrop; higher removes green edge fringe")
    parser.add_argument("--remove-all-green", action="store_true",
                        help="also remove enclosed key-color regions and all visible HSV-green pixels")
    parser.add_argument("--remove-enclosed-key", action="store_true",
                        help="remove enclosed pixels within the RGB key-distance threshold without broad HSV-green cleanup")
    parser.add_argument("--preserve-hidden-rgb", action="store_true",
                        help="keep RGB below keyed alpha for a later authored-mask restoration pass")
    parser.add_argument("--soft-key-inner", type=float,
                        help="start a full-canvas soft key at this RGB distance from the measured backdrop")
    parser.add_argument("--soft-key-outer", type=float,
                        help="finish the soft key at this RGB distance; pixels at or above it are opaque")
    parser.add_argument("--protect-depth", type=Path,
                        help="optional full Depth render used only inside --protect-rect regions")
    parser.add_argument("--protect-rect", action="append", default=[], metavar="X0,Y0,X1,Y1",
                        help="Depth-protected source rectangle; repeat for multiple authored olive regions")
    parser.add_argument("--protect-min-distance", type=float, default=30.0,
                        help="minimum RGB key distance allowed for Depth-protected pixels")
    parser.add_argument("--protect-dilate", type=int, default=4,
                        help="expand the Depth geometry before applying a protected rectangle")
    parser.add_argument("--nearest-opaque-edge-rgb", action="store_true",
                        help="replace semi-transparent key-edge RGB with the nearest opaque subject color")
    parser.add_argument("--preview", type=Path,
                        help="optional checkerboard preview for visual review of the resulting alpha")
    parser.add_argument("--green-hue-min", type=float, default=35.0,
                        help="minimum OpenCV-style HSV hue for --remove-all-green")
    parser.add_argument("--green-hue-max", type=float, default=90.0,
                        help="maximum OpenCV-style HSV hue for --remove-all-green")
    parser.add_argument("--green-saturation-min", type=int, default=24,
                        help="minimum HSV saturation for --remove-all-green")
    parser.add_argument("--green-value-min", type=int, default=24,
                        help="minimum HSV value for --remove-all-green")
    return parser.parse_args()


def edge_background_mask(close):
    h, w = close.shape
    mask = np.zeros((h, w), dtype=bool)
    todo = deque()
    for x in range(w):
        todo.append((0, x))
        todo.append((h - 1, x))
    for y in range(1, h - 1):
        todo.append((y, 0))
        todo.append((y, w - 1))
    while todo:
        y, x = todo.popleft()
        if mask[y, x] or not close[y, x]:
            continue
        mask[y, x] = True
        if x: todo.append((y, x - 1))
        if x + 1 < w: todo.append((y, x + 1))
        if y: todo.append((y - 1, x))
        if y + 1 < h: todo.append((y + 1, x))
    return mask


def main():
    args = parse_args()
    rgba = np.asarray(Image.open(args.src).convert("RGBA")).copy()
    rgb = rgba[..., :3].astype(np.float32)
    corners = np.vstack((rgb[:12, :12].reshape(-1, 3), rgb[:12, -12:].reshape(-1, 3),
                         rgb[-12:, :12].reshape(-1, 3), rgb[-12:, -12:].reshape(-1, 3)))
    key = np.median(corners, axis=0)
    distance = np.linalg.norm(rgb - key, axis=2)
    soft_mode = args.soft_key_inner is not None or args.soft_key_outer is not None
    global_removed = 0
    protected_pixels = 0
    if soft_mode:
        if args.soft_key_inner is None or args.soft_key_outer is None:
            raise SystemExit("--soft-key-inner and --soft-key-outer must be provided together")
        inner = float(args.soft_key_inner)
        outer = float(args.soft_key_outer)
        if not 0 <= inner < outer:
            raise SystemExit("soft key requires 0 <= inner < outer")
        t = np.clip((distance - inner) / (outer - inner), 0.0, 1.0)
        alpha = t * t * (3.0 - 2.0 * t)

        if args.protect_rect:
            if args.protect_depth is None:
                raise SystemExit("--protect-rect requires --protect-depth")
            depth = np.asarray(Image.open(args.protect_depth).convert("L"))
            if depth.shape != distance.shape:
                depth = np.asarray(Image.fromarray(depth, "L").resize(
                    (rgba.shape[1], rgba.shape[0]), Image.Resampling.BILINEAR))
            geometry = depth > 3
            if args.protect_dilate > 0:
                geometry = ndimage.binary_dilation(geometry, iterations=args.protect_dilate)
            protected = np.zeros_like(geometry)
            for raw_rect in args.protect_rect:
                x0, y0, x1, y1 = (int(value) for value in raw_rect.split(","))
                x0, x1 = sorted((max(0, x0), min(rgba.shape[1], x1)))
                y0, y1 = sorted((max(0, y0), min(rgba.shape[0], y1)))
                protected[y0:y1, x0:x1] |= geometry[y0:y1, x0:x1]
            protect_t = np.clip(
                (distance - float(args.protect_min_distance))
                / max(1e-6, inner - float(args.protect_min_distance)),
                0.0,
                1.0,
            )
            protect_alpha = protect_t * protect_t * (3.0 - 2.0 * protect_t)
            protect_alpha *= protected
            alpha = np.maximum(alpha, protect_alpha)
            protected_pixels = int(np.count_nonzero(protect_alpha > t))

        rgba[..., 3] = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
        global_removed = int(np.count_nonzero(rgba[..., 3] == 0))
    else:
        background = edge_background_mask(distance <= args.threshold)
        if args.remove_enclosed_key:
            enclosed_key = distance <= args.threshold
            global_removed = int(np.count_nonzero(enclosed_key & ~background))
            background |= enclosed_key
        if args.remove_all_green:
            hsv = np.asarray(Image.fromarray(rgba[..., :3], "RGB").convert("HSV"))
            # PIL hue is 0..255; expose the familiar OpenCV 0..179 range so the
            # green interval remains easy to audit alongside other asset scripts.
            hue = hsv[..., 0].astype(np.float32) * (179.0 / 255.0)
            green = ((hue >= args.green_hue_min) & (hue <= args.green_hue_max)
                     & (hsv[..., 1] >= args.green_saturation_min)
                     & (hsv[..., 2] >= args.green_value_min))
            global_background = (distance <= args.threshold) | green
            global_removed += int(np.count_nonzero(global_background & ~background))
            background |= global_background
        rgba[..., 3][background] = 0

    if args.nearest_opaque_edge_rgb:
        alpha = rgba[..., 3].astype(np.float32) / 255.0
        edge = (alpha > 0.0) & (alpha < 0.985)
        reliable = alpha >= 0.985
        if np.any(edge) and np.any(reliable):
            _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
            rgba[..., :3][edge] = rgba[..., :3][nearest[0][edge], nearest[1][edge]]
    # Hidden chroma RGB can bleed back into thumbnails during resampling even
    # when alpha is zero, so derived files keep canonical transparent pixels.
    if not args.preserve_hidden_rgb:
        rgba[rgba[..., 3] == 0] = (0, 0, 0, 0)
    args.dst.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(args.dst)
    if args.preview:
        h, w = rgba.shape[:2]
        yy, xx = np.indices((h, w))
        checker = np.where(((xx // 32 + yy // 32) % 2)[..., None],
                           np.array([92, 32, 104]), np.array([38, 24, 48])).astype(np.uint8)
        alpha = rgba[..., 3:4].astype(np.float32) / 255.0
        composite = np.clip(rgba[..., :3] * alpha + checker * (1.0 - alpha), 0, 255).astype(np.uint8)
        args.preview.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(composite, "RGB").save(args.preview)
    transparent_ratio = float(np.mean(rgba[..., 3] == 0))
    print(f"key={tuple(round(float(v), 1) for v in key)} transparent={transparent_ratio:.1%} "
          f"global_removed={global_removed} protected_pixels={protected_pixels} -> {args.dst}")


if __name__ == "__main__":
    main()
