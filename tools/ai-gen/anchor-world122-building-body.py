#!/usr/bin/env python3
"""Align a keyed/masked building body to the deterministic depth-footprint anchor.

The source body is never overwritten. The output is translated in the 1024 canvas
so its actual bottom support band lands on the same screen-space support band as
the Blender whitebox, then clipped once more by that whitebox mask.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def _opaque_contact(alpha: np.ndarray, threshold: int = 96) -> tuple[float, int] | None:
    """Mirror the runtime ground-contact scan used by structure-visual-anchor.js."""
    h, w = alpha.shape
    min_x = max(0, int(w * 0.20))
    max_x = min(w - 1, int(np.ceil(w * 0.80)))
    opaque = alpha >= threshold
    rows = np.where(opaque[:, min_x:max_x + 1].any(axis=1))[0]
    if len(rows) == 0:
        return None
    bottom = int(rows.max())
    band = max(4, round(h * 0.03))
    max_span = max(4, w * 0.12)
    weighted_x = 0.0
    total_weight = 0.0
    accepted = 0
    for y in range(bottom, max(-1, bottom - band), -1):
        xs = np.where(opaque[y, min_x:max_x + 1])[0]
        if len(xs) == 0:
            continue
        row_min = int(xs.min() + min_x)
        row_max = int(xs.max() + min_x)
        span = row_max - row_min + 1
        if span > max_span and accepted >= 3:
            break
        weight = 1.0 / (1.0 + (bottom - y) * 0.25)
        weighted_x += ((row_min + row_max) * 0.5) * weight
        total_weight += weight
        accepted += 1
    return (weighted_x / total_weight if total_weight else (w - 1) * 0.5), bottom


def _runtime_visual_offset_px(alpha: np.ndarray, display_width: float, display_height: float,
                              nominal_width: float = 256, nominal_height: float = 128) -> float:
    """Return the runtime-equivalent X offset in source-canvas pixels.

    The game measures the lowest contact and a side-face center, then moves the
    sprite by visualOffsetX. Convert that display-space offset back to the 1024
    source canvas so review composites match the in-game anchor.
    """
    contact = _opaque_contact(alpha)
    if not contact:
        return 0.0
    contact_x, bottom_y = contact
    h, w = alpha.shape
    min_x = max(0, int(w * 0.20))
    max_x = min(w - 1, int(np.ceil(w * 0.80)))
    # Same initial side-rise range as fitOpaqueGroundFootprint; choose the
    # widest valid run, which is stable for rectangular isometric footprints.
    scale_x = float(display_width) / max(1, w)
    candidates = []
    for rise in range(max(4, round(nominal_height * 0.20)),
                      max(4, round(nominal_height * 0.75)) + 1):
        source_rise = rise * h / max(1.0, float(display_height))
        y = int(np.clip(round(bottom_y - source_rise), 0, h - 1))
        xs = np.where(alpha[y, min_x:max_x + 1] >= 96)[0]
        if len(xs) == 0:
            continue
        row_min = int(xs.min() + min_x)
        row_max = int(xs.max() + min_x)
        left = (row_min - contact_x) * scale_x
        right = (row_max - contact_x) * scale_x
        span = right - left
        if (left >= -nominal_width * 0.15 or right <= nominal_width * 0.15
                or span < nominal_width * 0.35 or span > nominal_width * 1.20):
            continue
        candidates.append((span, (left + right) * 0.5))
    if not candidates:
        return 0.0
    max_span = max(span for span, _ in candidates)
    side_center = next(center for span, center in candidates if span >= max_span * 0.94)
    contact_offset = (0.5 - (contact_x + 0.5) / w) * float(display_width)
    display_offset = contact_offset - side_center
    return display_offset * w / max(1.0, float(display_width))


def support_anchor(alpha: np.ndarray, band: int = 36) -> tuple[float, int]:
    ys, xs = np.where(alpha > 16)
    if len(xs) == 0:
        h, w = alpha.shape
        return w * 0.5, h - 1
    bottom = int(ys.max())
    y0 = max(0, bottom - band)
    region = (ys >= y0)
    weights = np.maximum(alpha[ys[region], xs[region]].astype(np.float32), 1.0)
    # Heavier weighting toward the actual foot row avoids a tall tower bias.
    weights *= 1.0 + (ys[region] - y0) / max(1, band)
    return float(np.average(xs[region], weights=weights)), bottom


def translate_rgba(rgba: np.ndarray, dx: int, dy: int) -> np.ndarray:
    h, w = rgba.shape[:2]
    out = np.zeros_like(rgba)
    src_x0 = max(0, -dx)
    src_x1 = min(w, w - dx) if dx >= 0 else w
    src_y0 = max(0, -dy)
    src_y1 = min(h, h - dy) if dy >= 0 else h
    dst_x0 = max(0, dx)
    dst_y0 = max(0, dy)
    dst_x1 = dst_x0 + max(0, src_x1 - src_x0)
    dst_y1 = dst_y0 + max(0, src_y1 - src_y0)
    if src_x1 > src_x0 and src_y1 > src_y0:
        out[dst_y0:dst_y1, dst_x0:dst_x1] = rgba[src_y0:src_y1, src_x0:src_x1]
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("body", type=Path)
    parser.add_argument("depth", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--display-width", type=float, default=256)
    parser.add_argument("--display-height", type=float, default=256)
    parser.add_argument("--nominal-width", type=float, default=256)
    parser.add_argument("--nominal-height", type=float, default=128)
    parser.add_argument("--edge-pad", type=int, default=0,
                        help="depth-silhouette dilation retained while aligning thin generated details")
    args = parser.parse_args()
    body = np.asarray(Image.open(args.body).convert("RGBA")).copy()
    depth = np.asarray(Image.open(args.depth).convert("RGBA"))
    if body.shape[:2] != depth.shape[:2]:
        raise SystemExit(f"size mismatch: body={body.shape[:2]} depth={depth.shape[:2]}")
    depth_mask = (depth[..., :3].max(axis=2) > 4).astype(np.uint8) * 255
    clip_mask = depth_mask
    if args.edge_pad > 0:
        clip_mask = np.asarray(
            Image.fromarray(depth_mask, "L").filter(ImageFilter.MaxFilter(args.edge_pad * 2 + 1))
        )
    body_x, body_bottom = support_anchor(body[..., 3])
    depth_x, depth_bottom = support_anchor(depth_mask)
    # First match the deterministic canvas center and bottom row.  The
    # front-most contact point is intentionally not used as the X anchor: an
    # isometric rectangular footprint is asymmetric in screen space.  The
    # runtime visualOffsetX pass below handles that contact geometry.
    body_bbox = np.where(body[..., 3] > 16)
    depth_bbox = np.where(depth_mask > 16)
    body_center = ((body_bbox[1].min() + body_bbox[1].max()) * 0.5
                   if len(body_bbox[1]) else body.shape[1] * 0.5)
    depth_center = ((depth_bbox[1].min() + depth_bbox[1].max()) * 0.5
                    if len(depth_bbox[1]) else depth.shape[1] * 0.5)
    dx = int(round(depth_center - body_center))
    dy = int(depth_bottom - body_bottom)
    aligned = translate_rgba(body, dx, dy)
    aligned[..., 3] = np.minimum(aligned[..., 3], clip_mask)
    fit_dx = _runtime_visual_offset_px(
        aligned[..., 3], args.display_width, args.display_height,
        args.nominal_width, args.nominal_height,
    )
    if abs(fit_dx) >= 0.5:
        aligned = translate_rgba(aligned, int(round(fit_dx)), 0)
        aligned[..., 3] = np.minimum(aligned[..., 3], clip_mask)
    dx_total = dx + int(round(fit_dx))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(aligned, "RGBA").save(args.out)
    print(f"anchor body=({body_x:.1f},{body_bottom}) depth=({depth_x:.1f},{depth_bottom}) "
          f"centerShift=({dx},{dy}) runtimeX={fit_dx:.1f} totalX={dx_total} -> {args.out}")


if __name__ == "__main__":
    main()
