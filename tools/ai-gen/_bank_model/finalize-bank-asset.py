#!/usr/bin/env python3
"""Finalize the selected bank candidate into a clean transparent runtime PNG."""

import argparse

import numpy as np
from PIL import Image
from scipy import ndimage


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("src")
    parser.add_argument("dst")
    parser.add_argument("--desaturate", type=float, default=0.38)
    parser.add_argument("--display-width", type=int, default=266)
    args = parser.parse_args()

    rgb = np.asarray(Image.open(args.src).convert("RGB"), dtype=np.float32)
    height, width = rgb.shape[:2]
    margin = 12
    border = np.concatenate([
        rgb[:margin].reshape(-1, 3),
        rgb[-margin:].reshape(-1, 3),
        rgb[:, :margin].reshape(-1, 3),
        rgb[:, -margin:].reshape(-1, 3),
    ])
    background = np.median(border, axis=0)
    distance = np.linalg.norm(rgb - background, axis=2)

    labels, count = ndimage.label(distance > 90.0)
    if count == 0:
        raise SystemExit("no foreground component found")
    sizes = ndimage.sum(labels > 0, labels, range(1, count + 1))
    subject = labels == (1 + int(np.argmax(sizes)))
    subject = ndimage.binary_closing(subject, iterations=2)
    subject = ndimage.binary_fill_holes(subject)
    subject = ndimage.binary_erosion(subject, iterations=1)

    core = ndimage.binary_erosion(subject, iterations=1)
    support = ndimage.binary_dilation(subject, iterations=2)
    soft_alpha = np.clip((distance - 58.0) / 42.0, 0.0, 1.0)
    alpha = np.where(core, 1.0, np.where(support, soft_alpha, 0.0))
    alpha = ndimage.gaussian_filter(alpha, sigma=0.55)
    alpha[alpha < 0.025] = 0.0

    # Replace antialiased yellow-matte RGB with the nearest solid subject color.
    _, nearest = ndimage.distance_transform_edt(~core, return_indices=True)
    edge = (alpha > 0.0) & (alpha < 0.98)
    rgb[edge] = rgb[nearest[0][edge], nearest[1][edge]]

    luminance = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    keep = 1.0 - args.desaturate
    rgb = luminance[..., None] + (rgb - luminance[..., None]) * keep
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    alpha_u8 = np.clip(alpha * 255, 0, 255).astype(np.uint8)
    rgb[alpha_u8 == 0] = 0
    output = np.dstack([rgb, alpha_u8])
    Image.fromarray(output, "RGBA").save(args.dst, optimize=True)

    ys, xs = np.where(alpha_u8 > 200)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    bbox_width = x1 - x0
    bbox_height = y1 - y0
    display_height = round(args.display_width * bbox_height / bbox_width)
    foot_offset_y = round((y1 - height / 2.0) * display_height / height)
    print(f"background={background.astype(int).tolist()}")
    print(f"alpha_bbox=({x0},{y0},{x1},{y1}) size={bbox_width}x{bbox_height}")
    print(f"displayW={args.display_width} displayH={display_height} footOffsetY={foot_offset_y}")


if __name__ == "__main__":
    main()
