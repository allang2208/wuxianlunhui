#!/usr/bin/env python3
"""Build a core-anchored translucent hover sprite sheet from a chroma video.

This is intended for insects whose body is opaque while continuously moving
wings remain genuinely translucent.  BiRefNet supplies foreground support, a
known saturated chroma plate recovers soft alpha, and the main body core rather
than the changing wing/leg bounds is used as the per-frame anchor.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from rmbg_cutout import get_model, predict_alpha


def parse_hex(value: str) -> np.ndarray:
    value = value.lstrip("#")
    if len(value) != 6:
        raise argparse.ArgumentTypeError("color must be #RRGGBB")
    return np.array([int(value[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def largest_component(mask: np.ndarray) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if count <= 1:
        return np.zeros_like(mask, dtype=bool)
    keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return labels == keep


def sample_chroma_plate(rgb: np.ndarray, bg: np.ndarray, matte: np.ndarray) -> np.ndarray:
    """Measure the decoded plate; a requested #0000FF is rarely 255 in video."""
    height, width = matte.shape
    margin = max(8, min(height, width) // 15)
    corners = np.zeros_like(matte, dtype=bool)
    for rows in (slice(0, margin), slice(-margin, None)):
        for cols in (slice(0, margin), slice(-margin, None)):
            corners[rows, cols] = True
    key = int(np.argmax(bg))
    other = [channel for channel in range(3) if channel != key]
    work = rgb.astype(np.float32)
    samples = corners & (matte < 2) & (
        work[..., key] - work[..., other].max(axis=2) > 128
    )
    if int(samples.sum()) < 128:
        raise ValueError("not enough unambiguous background corners to calibrate chroma")
    return np.median(work[samples], axis=0).astype(np.float32)


def remove_blue_chroma_spill(
    foreground: np.ndarray,
    alpha: np.ndarray,
    radius: int,
    threshold: int,
) -> tuple[np.ndarray, np.ndarray, dict[str, int]]:
    stats = {"detected": 0, "recolored": 0, "cleared": 0,
             "blueCapped": 0, "disconnectedCleared": 0}
    if radius <= 0:
        return foreground, alpha, stats
    work = foreground.astype(np.int16)
    red, green, blue = work[..., 0], work[..., 1], work[..., 2]
    blue_only = (alpha > 3) & (blue > np.maximum(red, green) + threshold)
    cyan = (
        (alpha > 3)
        & (green > red + threshold)
        & (blue > red + threshold)
    )
    contaminated = blue_only | cyan
    reliable = (alpha > 16) & ~contaminated
    stats["detected"] = int(contaminated.sum())
    if contaminated.any() and reliable.any():
        size = radius * 2 + 1
        near_subject = cv2.dilate(
            reliable.astype(np.uint8),
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size)),
        ) > 0
        recolor = contaminated & near_subject
        clear = contaminated & ~near_subject
        _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
        foreground[recolor] = foreground[
            nearest[0][recolor], nearest[1][recolor]
        ]
        foreground[clear] = 0
        alpha[clear] = 0
        stats["recolored"] = int(recolor.sum())
        stats["cleared"] = int(clear.sum())

    # Remove fragments that only survived because one neutral compression pixel
    # inside an otherwise blue/cyan haze made that fragment self-supporting.
    connected = largest_component(alpha > 3)
    disconnected = (alpha > 0) & ~connected
    stats["disconnectedCleared"] = int(disconnected.sum())
    alpha[disconnected] = 0
    foreground[disconnected] = 0

    # Lanczos placement can reintroduce a few key-channel-heavy edge pixels.
    # Limit that last residual without changing alpha or neutral wing membranes.
    visible = alpha > 0
    peak = np.maximum(
        foreground[..., 0].astype(np.int16),
        foreground[..., 1].astype(np.int16),
    )
    cap_mask = visible & (foreground[..., 2].astype(np.int16) > peak + 6)
    foreground[..., 2][cap_mask] = np.clip(peak[cap_mask] + 6, 0, 255).astype(np.uint8)
    stats["blueCapped"] = int(cap_mask.sum())
    foreground[alpha == 0] = 0
    return foreground, alpha, stats


def remove_magenta_chroma_spill(
    foreground: np.ndarray,
    alpha: np.ndarray,
    radius: int,
    threshold: int,
) -> tuple[np.ndarray, np.ndarray, dict[str, int]]:
    """Remove semi-transparent purple fringing from blue-screen YUV bleed."""
    stats = {"magentaDetected": 0, "magentaRecolored": 0, "magentaCleared": 0}
    if radius <= 0:
        return foreground, alpha, stats
    work = foreground.astype(np.int16)
    red, green, blue = work[..., 0], work[..., 1], work[..., 2]
    magenta_hue = (red > green + threshold) & (blue > green + threshold)
    contaminated = (alpha > 3) & (alpha < 240) & magenta_hue
    reliable = (alpha > 16) & ~magenta_hue
    stats["magentaDetected"] = int(contaminated.sum())
    if contaminated.any() and reliable.any():
        size = radius * 2 + 1
        near_subject = cv2.dilate(
            reliable.astype(np.uint8),
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size)),
        ) > 0
        recolor = contaminated & near_subject
        clear = contaminated & ~near_subject
        _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
        foreground[recolor] = foreground[
            nearest[0][recolor], nearest[1][recolor]
        ]
        foreground[clear] = 0
        alpha[clear] = 0
        stats["magentaRecolored"] = int(recolor.sum())
        stats["magentaCleared"] = int(clear.sum())
    foreground[alpha == 0] = 0
    return foreground, alpha, stats


def recover_rgba(
    rgb: np.ndarray, bg: np.ndarray, birefnet: np.ndarray,
    clear_rect: tuple[float, float, float, float] | None = None,
    support_threshold: int = 16,
    support_dilate: int = 0,
    blue_spill_radius: int = 0,
    blue_spill_threshold: int = 20,
    magenta_spill_radius: int = 0,
    magenta_spill_threshold: int = 18,
    calibrated_plate: bool = False,
) -> tuple[np.ndarray, dict[str, int]]:
    key_channel = int(np.argmax(bg))
    if (bg[key_channel] < (160 if calibrated_plate else 245)
            or np.max(np.delete(bg, key_channel)) > (20 if calibrated_plate else 10)):
        raise ValueError("soft chroma recovery requires a saturated primary plate")
    other_channels = [index for index in range(3) if index != key_channel]
    spill = rgb[..., key_channel].astype(np.float32) - np.max(
        rgb[..., other_channels].astype(np.float32), axis=2
    )
    if calibrated_plate:
        plate_spill = float(bg[key_channel] - np.max(bg[other_channels]))
        alpha = 255.0 * (1.0 - np.clip(spill / plate_spill, 0.0, 1.0))
    else:
        alpha = 255.0 - np.clip(spill, 0.0, 255.0)
    # BiRefNet is a support gate, not a replacement alpha: replacing the matte
    # with its mostly opaque silhouette would destroy glass-like wing membranes.
    alpha[(birefnet < 2) & (alpha < 20)] = 0
    if calibrated_plate:
        # Use semantic support independently of chroma strength. Otherwise a
        # darker-than-requested blue plate becomes the largest "foreground".
        # This caps only the uncertain rim; opaque BiRefNet wing silhouettes
        # still receive the soft chroma alpha, never opaque replacement masks.
        semantic = largest_component(birefnet > 2)
        semantic = cv2.dilate(semantic.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        alpha[~semantic] = 0
        alpha = np.minimum(alpha, birefnet.astype(np.float32) * 16.0)
    alpha[alpha < 5] = 0
    alpha[alpha > 240] = 255
    if clear_rect:
        height, width = alpha.shape
        x0, y0, x1, y1 = clear_rect
        alpha[round(y0 * height):round(y1 * height),
              round(x0 * width):round(x1 * width)] = 0
    component = largest_component(alpha > support_threshold)
    if support_dilate > 0:
        size = support_dilate * 2 + 1
        component = cv2.dilate(
            component.astype(np.uint8),
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size)),
        ) > 0
    alpha[~component] = 0

    a = alpha / 255.0
    foreground = np.zeros_like(rgb, dtype=np.float32)
    visible = a > 0.015
    foreground[visible] = (
        rgb[visible].astype(np.float32)
        - (1.0 - a[visible, None]) * bg[None, :]
    ) / np.maximum(a[visible, None], 1e-3)
    foreground = np.clip(foreground, 0, 255).astype(np.uint8)
    foreground[~visible] = 0
    if blue_spill_radius > 0 and key_channel == 2:
        # H.264/YUV smearing around a pure-blue plate often arrives as cyan,
        # so inverse matting and a blue-channel clamp alone cannot remove it.
        # Keep cyan pixels close to a reliable non-cyan subject edge (wing
        # antialiasing) but recolor them from the nearest clean foreground;
        # discard only cyan haze farther away from real subject pixels.
        foreground, alpha, spill_stats = remove_blue_chroma_spill(
            foreground, alpha, blue_spill_radius, blue_spill_threshold,
        )
    else:
        spill_stats = {"detected": 0, "recolored": 0, "cleared": 0,
                       "blueCapped": 0, "disconnectedCleared": 0}
    foreground, alpha, magenta_stats = remove_magenta_chroma_spill(
        foreground, alpha, magenta_spill_radius, magenta_spill_threshold,
    )
    spill_stats.update(magenta_stats)
    spill_stats["greenYellowRecolored"] = 0
    if calibrated_plate:
        foreground, spill_stats["greenYellowRecolored"] = remove_green_yellow_fringe(foreground, alpha)
    foreground[alpha == 0] = 0
    return np.dstack([foreground, alpha.astype(np.uint8)]), spill_stats


def remove_green_yellow_fringe(foreground: np.ndarray, alpha: np.ndarray) -> tuple[np.ndarray, int]:
    """Repair inverse-blue-matte RGB spill without removing soft wing alpha.

    Calibrated neutral/brown insects can retain green codec specks and yellow
    fringing in translucent pixels. Opaque bronze highlights are not yellow
    fringe; only green dominance or a translucent yellow edge is recolored.
    """
    work = foreground.astype(np.int16)
    red, green, blue = work[..., 0], work[..., 1], work[..., 2]
    green_spill = (green > red + 12) & (green > blue + 12)
    yellow_hue = (red > blue + 50) & (green > blue + 50) & (green > red - 25)
    yellow_edge = (alpha < 240) & yellow_hue
    contaminated = (alpha > 3) & (green_spill | yellow_edge)
    reliable = (alpha > 16) & (work.max(axis=2) >= 24) & ~(green_spill | yellow_hue)
    if contaminated.any() and reliable.any():
        _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
        foreground[contaminated] = foreground[nearest[0][contaminated], nearest[1][contaminated]]
    return foreground, int(contaminated.sum())


def body_core(rgba: np.ndarray) -> tuple[float, float]:
    rgb = rgba[..., :3]
    alpha = rgba[..., 3]
    core = (alpha > 235) & (rgb.mean(axis=2) < 175)
    core = cv2.morphologyEx(
        core.astype(np.uint8), cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)),
    ) > 0
    core = largest_component(core)
    ys, xs = np.where(core)
    if not len(xs):
        ys, xs = np.where(alpha > 220)
    if not len(xs):
        raise RuntimeError("could not locate opaque body core")
    return float(xs.mean()), float(ys.mean())


def alpha_bbox(rgba: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(rgba[..., 3] > 4)
    if not len(xs):
        raise RuntimeError("empty recovered frame")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def checker(width: int, height: int, tile: int = 24) -> Image.Image:
    yy, xx = np.indices((height, width))
    pattern = ((xx // tile + yy // tile) & 1)[..., None]
    lo = np.array([58, 62, 68], dtype=np.uint8)
    hi = np.array([92, 97, 104], dtype=np.uint8)
    return Image.fromarray(np.where(pattern, hi, lo).astype(np.uint8), "RGB")


def preview_frame(rgba: np.ndarray, width: int, height: int) -> Image.Image:
    subject = Image.fromarray(rgba, "RGBA")
    if subject.size != (width, height):
        subject = subject.resize((width, height), Image.Resampling.LANCZOS)
    base = checker(width, height).convert("RGBA")
    base.alpha_composite(subject)
    return base.convert("RGB")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--frames", default="6,8,10,12")
    ap.add_argument("--bg-color", default="#0000FF")
    ap.add_argument("--calibrate-chroma", action="store_true",
                    help="sample decoded background and use BiRefNet semantic support")
    ap.add_argument("--placement-report", type=Path,
                    help="reuse accepted source-frame scale/core transforms exactly")
    ap.add_argument("--cell", type=int, default=512)
    ap.add_argument("--cell-width", type=int,
                    help="optional non-square cell width; defaults to --cell")
    ap.add_argument("--cell-height", type=int,
                    help="optional non-square cell height; defaults to --cell")
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--padding", type=int, default=24)
    ap.add_argument("--fixed-scale", type=float,
                    help="reuse one subject scale across multiple action sheets")
    ap.add_argument("--target-core-x", type=float,
                    help="shared destination X for the opaque body core")
    ap.add_argument("--target-core-y", type=float,
                    help="shared destination Y for the opaque body core")
    ap.add_argument("--anchor-mode", choices=("per-frame", "first-frame"),
                    default="per-frame",
                    help="first-frame preserves source lunge/fall displacement")
    ap.add_argument("--clear-rect",
                    help="normalized x0,y0,x1,y1 rectangle cleared before component filtering")
    ap.add_argument("--support-alpha-threshold", type=int, default=16,
                    help="alpha threshold used to isolate the primary subject component")
    ap.add_argument("--support-dilate", type=int, default=0,
                    help="pixels to expand primary support before restoring soft translucent edges")
    ap.add_argument("--blue-spill-radius", type=int, default=0,
                    help="retain/recolor cyan spill only this many pixels from clean subject support")
    ap.add_argument("--blue-spill-threshold", type=int, default=20,
                    help="minimum cyan excess over red treated as blue-plate contamination")
    ap.add_argument("--magenta-spill-radius", type=int, default=0,
                    help="recolor semi-transparent purple YUV fringe this many pixels from clean support")
    ap.add_argument("--magenta-spill-threshold", type=int, default=18,
                    help="minimum red+blue excess over green treated as purple plate contamination")
    ap.add_argument("--clear-output-rect",
                    help="normalized cell x0,y0,x1,y1 rectangle cleared after anchoring")
    ap.add_argument("--clear-output-rect-start", type=int, default=0,
                    help="first selected-frame position that receives --clear-output-rect")
    ap.add_argument("--clear-output-rect-at", action="append", default=[],
                    help="position:x0,y0,x1,y1 local cell rectangle; repeat per selected frame")
    ap.add_argument("--frame-rate", type=float, default=12.0)
    ap.add_argument("--frames-dir", type=Path)
    ap.add_argument("--preview-gif", type=Path)
    ap.add_argument("--contact", type=Path)
    ap.add_argument("--report", type=Path)
    args = ap.parse_args()

    selected = [int(value) for value in args.frames.split(",") if value.strip()]
    cell_width = args.cell_width or args.cell
    cell_height = args.cell_height or args.cell
    if cell_width <= 0 or cell_height <= 0:
        raise SystemExit("cell dimensions must be positive")
    if (not 1 <= args.support_alpha_threshold <= 255 or args.support_dilate < 0
            or args.blue_spill_radius < 0 or args.blue_spill_threshold < 0
            or args.magenta_spill_radius < 0 or args.magenta_spill_threshold < 0):
        raise SystemExit("support alpha threshold/dilation is outside its valid range")
    clear_rect = None
    if args.clear_rect:
        values = tuple(float(value) for value in args.clear_rect.split(","))
        if len(values) != 4 or any(value < 0 or value > 1 for value in values):
            raise SystemExit("--clear-rect must be four normalized values in 0..1")
        clear_rect = values
    clear_output_rect = None
    if args.clear_output_rect:
        values = tuple(float(value) for value in args.clear_output_rect.split(","))
        if len(values) != 4 or any(value < 0 or value > 1 for value in values):
            raise SystemExit("--clear-output-rect must be four normalized values in 0..1")
        clear_output_rect = values
    clear_output_rects_at: dict[int, tuple[float, float, float, float]] = {}
    for spec in args.clear_output_rect_at:
        try:
            position_text, values_text = spec.split(":", 1)
            position = int(position_text)
            values = tuple(float(value) for value in values_text.split(","))
        except ValueError as exc:
            raise SystemExit(
                "--clear-output-rect-at must use position:x0,y0,x1,y1"
            ) from exc
        if position < 0 or len(values) != 4 or any(value < 0 or value > 1 for value in values):
            raise SystemExit("--clear-output-rect-at position/rectangle is outside its valid range")
        clear_output_rects_at[position] = values
    container = av.open(str(args.video))
    decoded = [np.array(frame.to_image().convert("RGB")) for frame in container.decode(video=0)]
    container.close()
    if not selected or min(selected) < 0 or max(selected) >= len(decoded):
        raise SystemExit(f"selected frames {selected} outside decoded range 0..{len(decoded) - 1}")

    placement = None
    if args.placement_report:
        placement = json.loads(args.placement_report.read_text(encoding="utf-8"))
        if placement["sourceFrames"] != selected or len(placement["coreCenters"]) != len(selected):
            raise SystemExit("placement report must describe the exact selected source frames")
        prior_width = placement.get("cellWidth", placement["cell"])
        prior_height = placement.get("cellHeight", placement["cell"])
        if (prior_width, prior_height) != (cell_width, cell_height):
            raise SystemExit("placement report cell dimensions do not match the output")

    model = get_model()
    bg = parse_hex(args.bg_color)
    recovered: list[np.ndarray] = []
    spill_stats: list[dict[str, int]] = []
    cores: list[tuple[float, float]] = []
    bboxes: list[tuple[int, int, int, int]] = []
    sampled_backgrounds: list[list[float]] = []
    for index in selected:
        rgb = decoded[index]
        matte = predict_alpha(model, Image.fromarray(rgb, "RGB"))
        frame_bg = sample_chroma_plate(rgb, bg, matte) if args.calibrate_chroma else bg
        sampled_backgrounds.append(frame_bg.tolist())
        rgba, frame_spill_stats = recover_rgba(
            rgb, frame_bg, matte, clear_rect,
            args.support_alpha_threshold, args.support_dilate,
            args.blue_spill_radius, args.blue_spill_threshold,
            args.magenta_spill_radius, args.magenta_spill_threshold,
            args.calibrate_chroma,
        )
        recovered.append(rgba)
        spill_stats.append(frame_spill_stats)
        cores.append(body_core(rgba))
        bboxes.append(alpha_bbox(rgba))

    if placement:
        cores = [tuple(core) for core in placement["coreCenters"]]
        args.anchor_mode = placement["anchorMode"]
    anchor_cores = cores if args.anchor_mode == "per-frame" else [cores[0]] * len(cores)
    min_dx = min(box[0] - core[0] for box, core in zip(bboxes, anchor_cores))
    min_dy = min(box[1] - core[1] for box, core in zip(bboxes, anchor_cores))
    max_dx = max(box[2] - core[0] for box, core in zip(bboxes, anchor_cores))
    max_dy = max(box[3] - core[1] for box, core in zip(bboxes, anchor_cores))
    usable_x = cell_width - 2 * args.padding
    usable_y = cell_height - 2 * args.padding
    fit_scale = min(
        usable_x / (max_dx - min_dx + 1),
        usable_y / (max_dy - min_dy + 1),
    )
    scale = args.fixed_scale if args.fixed_scale is not None else fit_scale
    target_x = args.target_core_x if args.target_core_x is not None else args.padding - min_dx * scale
    target_y = args.target_core_y if args.target_core_y is not None else args.padding - min_dy * scale
    if placement:
        scale = placement["scale"]
        target_x, target_y = placement["targetCore"]

    cells: list[np.ndarray] = []
    for position, (rgba, core) in enumerate(zip(recovered, anchor_cores)):
        matrix = np.array([
            [scale, 0.0, target_x - scale * core[0]],
            [0.0, scale, target_y - scale * core[1]],
        ], dtype=np.float32)
        rgb = cv2.warpAffine(
            rgba[..., :3], matrix, (cell_width, cell_height),
            flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0),
        )
        alpha = cv2.warpAffine(
            rgba[..., 3], matrix, (cell_width, cell_height),
            flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=0,
        )
        alpha[alpha < 3] = 0
        rgb[alpha == 0] = 0
        if args.blue_spill_radius > 0:
            rgb, alpha, placed_spill_stats = remove_blue_chroma_spill(
                rgb, alpha, args.blue_spill_radius, args.blue_spill_threshold,
            )
            for key, value in placed_spill_stats.items():
                spill_stats[position][key] += value
        if args.magenta_spill_radius > 0:
            rgb, alpha, placed_magenta_stats = remove_magenta_chroma_spill(
                rgb, alpha, args.magenta_spill_radius, args.magenta_spill_threshold,
            )
            for key, value in placed_magenta_stats.items():
                spill_stats[position][key] += value
        if args.calibrate_chroma:
            rgb, recolored = remove_green_yellow_fringe(rgb, alpha)
            spill_stats[position]["greenYellowRecolored"] += recolored
        output_rects = []
        if clear_output_rect and position >= args.clear_output_rect_start:
            output_rects.append(clear_output_rect)
        if position in clear_output_rects_at:
            output_rects.append(clear_output_rects_at[position])
        for x0, y0, x1, y1 in output_rects:
            sx = slice(round(x0 * cell_width), round(x1 * cell_width))
            sy = slice(round(y0 * cell_height), round(y1 * cell_height))
            alpha[sy, sx] = 0
            rgb[sy, sx] = 0
        cells.append(np.dstack([rgb, alpha]))

    rows = math.ceil(len(cells) / args.cols)
    sheet = np.zeros((rows * cell_height, args.cols * cell_width, 4), dtype=np.uint8)
    for position, cell in enumerate(cells):
        row, col = divmod(position, args.cols)
        sheet[row * cell_height:(row + 1) * cell_height,
              col * cell_width:(col + 1) * cell_width] = cell
    args.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sheet, "RGBA").save(args.out)

    if args.frames_dir:
        args.frames_dir.mkdir(parents=True, exist_ok=True)
        for position, (source_index, cell) in enumerate(zip(selected, cells)):
            Image.fromarray(cell, "RGBA").save(
                args.frames_dir / f"key-{position:02d}-source-{source_index:03d}.png"
            )
    previews = [preview_frame(cell, cell_width, cell_height) for cell in cells]
    if args.preview_gif:
        args.preview_gif.parent.mkdir(parents=True, exist_ok=True)
        previews[0].save(
            args.preview_gif, save_all=True, append_images=previews[1:],
            duration=round(1000 / args.frame_rate), loop=0, disposal=2,
        )
    if args.contact:
        args.contact.parent.mkdir(parents=True, exist_ok=True)
        contact = Image.new("RGB", (args.cols * cell_width, rows * cell_height), (35, 35, 35))
        draw = ImageDraw.Draw(contact)
        for position, (source_index, frame) in enumerate(zip(selected, previews)):
            row, col = divmod(position, args.cols)
            x, y = col * cell_width, row * cell_height
            contact.paste(frame, (x, y))
            draw.text((x + 8, y + 8), f"source {source_index}", fill="white")
        contact.save(args.contact)

    report = {
        "video": str(args.video),
        "decodedFrameCount": len(decoded),
        "sourceFrames": selected,
        "background": args.bg_color,
        "calibratedChroma": args.calibrate_chroma,
        "sampledBackgrounds": sampled_backgrounds,
        "placementReport": str(args.placement_report) if args.placement_report else None,
        "clearRect": clear_rect,
        "supportAlphaThreshold": args.support_alpha_threshold,
        "supportDilate": args.support_dilate,
        "blueSpillRadius": args.blue_spill_radius,
        "blueSpillThreshold": args.blue_spill_threshold,
        "magentaSpillRadius": args.magenta_spill_radius,
        "magentaSpillThreshold": args.magenta_spill_threshold,
        "blueSpillPixels": {
            key: sum(item[key] for item in spill_stats)
            for key in spill_stats[0]
        },
        "clearOutputRect": clear_output_rect,
        "clearOutputRectStart": args.clear_output_rect_start,
        "clearOutputRectsAt": {
            str(position): list(rect) for position, rect in clear_output_rects_at.items()
        },
        "cell": args.cell,
        "cellWidth": cell_width,
        "cellHeight": cell_height,
        "cols": args.cols,
        "rows": rows,
        "frameRate": args.frame_rate,
        "scale": scale,
        "fitScale": fit_scale,
        "targetCore": [target_x, target_y],
        "anchorMode": args.anchor_mode,
        "coreCenters": [[round(x, 3), round(y, 3)] for x, y in cores],
        "semiTransparentPixels": [
            int(((cell[..., 3] > 3) & (cell[..., 3] < 240)).sum()) for cell in cells
        ],
        "output": str(args.out),
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
