#!/usr/bin/env python3
"""Create a tightly-cropped, aspect-safe RGBA runtime building texture.

The important contract is that Phaser scales the complete texture canvas.  The
runtime display height must therefore be derived from the final cropped canvas,
not from an alpha bounding box still sitting inside a square source image.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def alpha_from_flat_background(rgb):
    height, width = rgb.shape[:2]
    margin = max(4, min(12, min(width, height) // 32))
    border = np.concatenate([
        rgb[:margin].reshape(-1, 3),
        rgb[-margin:].reshape(-1, 3),
        rgb[:, :margin].reshape(-1, 3),
        rgb[:, -margin:].reshape(-1, 3),
    ])
    background = np.median(border, axis=0)
    distance = np.linalg.norm(rgb - background, axis=2)

    # Flat-color renders often contain a soft cast shadow.  Its darker yellow
    # pixels can pass the foreground threshold and remain connected to the
    # foundation.  Flood the background inward through a wider color-distance
    # band so those border-connected shadow gradients are rejected without
    # erasing enclosed warm details such as lamps, sacks or straw.
    background_seed = np.zeros((height, width), dtype=bool)
    background_seed[0, :] = True
    background_seed[-1, :] = True
    background_seed[:, 0] = True
    background_seed[:, -1] = True
    background_reachable = ndimage.binary_propagation(
        background_seed,
        mask=distance < 150.0,
    )

    labels, count = ndimage.label(distance > 82.0)
    if count == 0:
        raise SystemExit("no foreground component found")
    sizes = ndimage.sum(labels > 0, labels, range(1, count + 1))
    subject = (labels == (1 + int(np.argmax(sizes)))) & ~background_reachable
    subject = ndimage.binary_closing(subject, iterations=2)
    # Do not fill enclosed background-color gaps.  Courtyards, open doors and
    # concave foundation corners can surround keyed background pixels; filling
    # them turns the original yellow backdrop into opaque wedges.
    subject = ndimage.binary_erosion(subject, iterations=1)

    core = ndimage.binary_erosion(subject, iterations=1)
    support = ndimage.binary_dilation(subject, iterations=2)
    soft = np.clip((distance - 48.0) / 46.0, 0.0, 1.0)
    alpha = np.where(core, 1.0, np.where(support, soft, 0.0))
    alpha = ndimage.gaussian_filter(alpha, sigma=0.55)
    alpha[alpha < 0.02] = 0.0

    # Remove the yellow/flat-color matte from antialiased boundary pixels.
    _, nearest = ndimage.distance_transform_edt(~core, return_indices=True)
    edge = (alpha > 0.0) & (alpha < 0.985)
    rgb[edge] = rgb[nearest[0][edge], nearest[1][edge]]
    return alpha, background


def parse_hex_color(value):
    raw = value.strip().lstrip("#")
    if len(raw) != 6:
        raise argparse.ArgumentTypeError("matte color must be #RRGGBB")
    try:
        return np.asarray([int(raw[index:index + 2], 16) for index in (0, 2, 4)], dtype=np.float32)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("matte color must be #RRGGBB") from exc


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("src")
    parser.add_argument("dst")
    parser.add_argument("--display-width", type=int, required=True)
    parser.add_argument("--padding", type=int, default=4)
    parser.add_argument("--desaturate", type=float, default=0.0)
    parser.add_argument("--matte-color", type=parse_hex_color,
                        help="Remove a known flat-background color from existing RGBA antialiasing without changing alpha")
    parser.add_argument("--matte-edge-width", type=float, default=0.0,
                        help="Also repair opaque matte-colored pixels this many source pixels inside the alpha edge")
    parser.add_argument("--matte-tolerance", type=float, default=110.0,
                        help="RGB distance from --matte-color treated as contamination in the edge band")
    parser.add_argument("--mask-image", help="Depth/control render used to reject generated shadows outside the modeled silhouette")
    parser.add_argument("--mask-dilate", type=int, default=10,
                        help="Positive expands the model mask; negative contracts it to remove generated matte fringes")
    parser.add_argument("--mask-add-rect", action="append", default=[], metavar="X0,Y0,X1,Y1",
                        help="Keep an additional generated detail region that intentionally exceeds the model mask")
    parser.add_argument("--metadata")
    args = parser.parse_args()

    source = Image.open(args.src)
    rgba = np.asarray(source.convert("RGBA"), dtype=np.uint8).copy()
    rgb = rgba[..., :3].astype(np.float32)
    source_alpha = rgba[..., 3].astype(np.float32) / 255.0
    has_real_alpha = source.mode in ("RGBA", "LA") and np.any(rgba[..., 3] < 250)
    background = None
    if has_real_alpha:
        alpha = source_alpha
        if args.matte_color is not None:
            a = alpha[..., None]
            foreground = (rgb - (1.0 - a) * args.matte_color) / np.maximum(a, 1e-3)
            edge = (alpha > 0.0) & (alpha < 0.999)
            rgb[edge] = foreground[edge]
            if args.matte_edge_width > 0:
                opaque = alpha > 0.02
                inside_distance = ndimage.distance_transform_edt(opaque)
                matte_distance = np.linalg.norm(rgb - args.matte_color, axis=2)
                contaminated = (opaque
                                & (inside_distance <= float(args.matte_edge_width))
                                & (matte_distance < float(args.matte_tolerance)))
                reliable = opaque & ~contaminated & (alpha > 0.5)
                if np.any(contaminated) and np.any(reliable):
                    _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
                    rgb[contaminated] = rgb[nearest[0][contaminated], nearest[1][contaminated]]
    else:
        alpha, background = alpha_from_flat_background(rgb)

    if args.mask_image:
        mask_image = Image.open(args.mask_image).convert("L")
        if mask_image.size != source.size:
            mask_image = mask_image.resize(source.size, Image.Resampling.BILINEAR)
        modeled = np.asarray(mask_image, dtype=np.uint8) > 3
        modeled = ndimage.binary_fill_holes(modeled)
        for raw_rect in args.mask_add_rect:
            x0, y0, x1, y1 = (int(value) for value in raw_rect.split(","))
            x0, x1 = sorted((max(0, x0), min(source.width, x1)))
            y0, y1 = sorted((max(0, y0), min(source.height, y1)))
            modeled[y0:y1, x0:x1] = True
        mask_adjust = int(args.mask_dilate)
        if mask_adjust > 0:
            modeled = ndimage.binary_dilation(modeled, iterations=mask_adjust)
        elif mask_adjust < 0:
            modeled = ndimage.binary_erosion(modeled, iterations=-mask_adjust)
        modeled_soft = ndimage.gaussian_filter(modeled.astype(np.float32), sigma=0.7)
        alpha *= np.clip(modeled_soft, 0.0, 1.0)

    if args.desaturate:
        amount = float(np.clip(args.desaturate, 0.0, 1.0))
        luminance = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
        rgb = luminance[..., None] + (rgb - luminance[..., None]) * (1.0 - amount)

    alpha_u8 = np.clip(alpha * 255, 0, 255).astype(np.uint8)
    # Discard sub-visible matte specks left by the soft edge blur.  Values at
    # this level do not contribute useful antialiasing at game scale.
    alpha_u8[alpha_u8 < 8] = 0
    ys, xs = np.where(alpha_u8 > 0)
    if not len(xs):
        raise SystemExit("empty alpha after extraction")
    pad = max(0, int(args.padding))
    x0 = max(0, int(xs.min()) - pad)
    y0 = max(0, int(ys.min()) - pad)
    x1 = min(alpha_u8.shape[1], int(xs.max()) + 1 + pad)
    y1 = min(alpha_u8.shape[0], int(ys.max()) + 1 + pad)

    rgb_u8 = np.clip(rgb, 0, 255).astype(np.uint8)
    rgb_u8[alpha_u8 == 0] = 0
    output = np.dstack([rgb_u8, alpha_u8])[y0:y1, x0:x1]
    destination = Path(args.dst)
    destination.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(output, "RGBA").save(destination, optimize=True)

    final_h, final_w = output.shape[:2]
    display_w = int(args.display_width)
    scale = display_w / final_w
    display_h = round(final_h * scale)
    local_alpha = output[..., 3]
    local_ys, local_xs = np.where(local_alpha > 0)
    alpha_bottom = int(local_ys.max())
    foot_offset = round(((alpha_bottom + 1) - final_h / 2.0) * scale)
    metadata = {
        "source": str(Path(args.src)),
        "output": str(destination),
        "sourceMode": source.mode,
        "background": background.astype(int).tolist() if background is not None else None,
        "matteColor": args.matte_color.astype(int).tolist() if args.matte_color is not None else None,
        "matteEdgeWidth": float(args.matte_edge_width) if args.matte_color is not None else None,
        "matteTolerance": float(args.matte_tolerance) if args.matte_color is not None else None,
        "maskImage": str(Path(args.mask_image)) if args.mask_image else None,
        "maskDilate": int(args.mask_dilate) if args.mask_image else None,
        "maskAddRects": args.mask_add_rect if args.mask_image else [],
        "cropBox": [x0, y0, x1, y1],
        "fileSize": [final_w, final_h],
        "alphaBBox": [int(local_xs.min()), int(local_ys.min()),
                      int(local_xs.max()) + 1, int(local_ys.max()) + 1],
        "displayW": display_w,
        "displayH": display_h,
        "footOffsetY": foot_offset,
        "scaleX": scale,
        "scaleY": display_h / final_h,
    }
    if args.metadata:
        Path(args.metadata).write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
