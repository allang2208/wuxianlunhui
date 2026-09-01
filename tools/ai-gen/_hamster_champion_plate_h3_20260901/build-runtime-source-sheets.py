#!/usr/bin/env python3
"""Build compact, transparent pre-interpolation sheets from approved H3 videos.

The transform is fixed within each action: source-space motion is preserved and
the body is never fitted or re-centered per frame. Each video's fixed camera
scale is normalized once to the same effective upright body height. Thin sword
pixels are excluded from body-height calibration but retained in the union crop.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
HELPER_PATH = REPO / "tools" / "ai-gen" / "jungle-wizard-video-rebuild.py"
SPEC = importlib.util.spec_from_file_location("champion_h3_helper", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import sprite helper: {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)

TARGET_BODY_HEIGHT = 185
BODY_OPEN_KERNEL = 23
MARGIN = 12
CELL_QUANTUM = 32


@dataclass(frozen=True)
class ActionSpec:
    name: str
    config_key: str
    video_name: str
    indices: tuple[int, ...]
    source_sheet_fps: float
    runtime_fps: float
    repeat: int
    preserve_vertical_motion: bool = False
    interpolation_mode: str = "rife2x"


def loop_indices(total: int, count: int) -> tuple[int, ...]:
    """Uniform loop samples excluding the duplicated endpoint."""
    return tuple(int(math.floor(i * total / count)) for i in range(count))


def locked_endpoint_indices(end_inclusive: int, count: int) -> tuple[int, ...]:
    """Uniform samples including an H3 endpoint explicitly locked to frame 0."""
    return tuple(int(round(i * end_inclusive / (count - 1))) for i in range(count))


SPECS = (
    ActionSpec("idle", "idle", "idle-h3-v02.mp4", loop_indices(124, 12), 6.0, 12.0, -1),
    ActionSpec(
        "running", "walk", "running-h3-v03.mp4",
        # f41 and f61 are the same planted-leg phase in the steady middle run.
        # Keep [41,61): one complete 20-frame cycle at the native 24 fps, then
        # play the mandatory 2x RIFE result at 48 fps so duration stays 0.833 s.
        tuple(range(41, 61)), 24.0, 48.0, -1,
    ),
    ActionSpec(
        "attacking", "attack", "attacking-h3-v04.mp4",
        # RIFE changed the two-handed sword/arms and its alpha-bottom alignment
        # mistook the low blade tip for a foot. Use native H3 half-step frames
        # instead: f0,f3,...,f120 supplies the same 41-frame runtime clock with
        # no synthesized topology and no per-frame root correction.
        tuple(range(0, 121, 3)), 41.0 / 0.5, 41.0 / 0.5, 0,
        interpolation_mode="native-source",
    ),
    # f96 is already a stable corpse; f100..f123 are redundant hold frames.
    ActionSpec(
        "dying", "dying", "dying-h3-v03.mp4",
        tuple(range(0, 97, 8)), 7.5, 15.0, 0, True,
    ),
)


# Preserve the already integrated attack footprint exactly while replacing its
# malformed RIFE middles. These are the fixed-layout values recorded before the
# repair; they prevent a source-resampling change from moving the runtime anchor.
LOCKED_LAYOUTS: dict[str, dict[str, float | int]] = {
    "attacking": {
        "frameWidth": 544,
        "frameHeight": 288,
        "anchorX": 541.0,
        "anchorY": 511.0,
        "footY": 228,
        "scale": 0.4830287206266319,
        "sourceMedianUprightBodyHeight": 383.0,
    },
}


def detected_background(rgb: np.ndarray) -> np.ndarray:
    margin = 12
    ring = np.concatenate((
        rgb[:margin].reshape(-1, 3),
        rgb[-margin:].reshape(-1, 3),
        rgb[:, :margin].reshape(-1, 3),
        rgb[:, -margin:].reshape(-1, 3),
    ))
    return np.median(ring, axis=0).astype(np.float32)


def keep_near_subject(alpha: np.ndarray) -> np.ndarray:
    foreground = (alpha > 12).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count <= 1:
        raise RuntimeError("BiRefNet produced no foreground component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    lx = int(stats[largest, cv2.CC_STAT_LEFT])
    ly = int(stats[largest, cv2.CC_STAT_TOP])
    lw = int(stats[largest, cv2.CC_STAT_WIDTH])
    lh = int(stats[largest, cv2.CC_STAT_HEIGHT])
    expanded = (lx - 96, ly - 96, lx + lw + 96, ly + lh + 96)
    keep = labels == largest
    for label in range(1, count):
        if label == largest or int(stats[label, cv2.CC_STAT_AREA]) < 8:
            continue
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        if x < expanded[2] and x + w > expanded[0] and y < expanded[3] and y + h > expanded[1]:
            keep |= labels == label
    cleaned = alpha.copy()
    cleaned[~keep] = 0
    cleaned[cleaned < 4] = 0
    return cleaned


def cutout_rgba(rgb: np.ndarray, model) -> np.ndarray:
    biref = np.asarray(HELPER.predict_alpha(model, Image.fromarray(rgb, "RGB")))
    biref = np.squeeze(biref)
    if biref.shape != rgb.shape[:2]:
        biref = cv2.resize(biref, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR)
    if biref.max(initial=0) <= 1.5:
        biref = biref * 255.0
    biref = np.clip(biref, 0, 255).astype(np.uint8)

    bg = detected_background(rgb)
    distance = np.linalg.norm(rgb.astype(np.float32) - bg, axis=2)
    chroma = np.clip((distance - 18.0) / 30.0, 0.0, 1.0)
    semantic_support = ndimage.binary_dilation(biref > 8, iterations=12)
    alpha = np.maximum(biref.astype(np.float32) / 255.0, chroma * semantic_support)
    alpha = keep_near_subject(np.rint(alpha * 255.0).astype(np.uint8))

    a = alpha.astype(np.float32) / 255.0
    foreground = (rgb.astype(np.float32) - (1.0 - a[..., None]) * bg) / np.maximum(a[..., None], 1e-3)
    foreground = np.clip(foreground, 0, 255).astype(np.uint8)
    foreground[alpha == 0] = 0
    return np.dstack((foreground, alpha))


def despill_blue_chroma(rgba: np.ndarray, threshold: int = 18) -> tuple[np.ndarray, int]:
    """Neutralize the running plate's blue-screen fringe before interpolation."""
    result = rgba.copy()
    visible = result[..., 3] > 0
    work = result[..., :3].astype(np.int16)
    red, green, blue = work[..., 0], work[..., 1], work[..., 2]
    cyan = visible & (green > red + threshold) & (blue > red + threshold)
    if cyan.any():
        cap = np.clip(red[cyan] + threshold, 0, 255).astype(np.uint8)
        result[..., 1][cyan] = np.minimum(result[..., 1][cyan], cap)
        result[..., 2][cyan] = np.minimum(result[..., 2][cyan], cap)
    red = result[..., 0].astype(np.int16)
    green = result[..., 1].astype(np.int16)
    blue = result[..., 2].astype(np.int16)
    peak = np.maximum(red, green)
    blue_excess = visible & (blue > peak + 6)
    if blue_excess.any():
        result[..., 2][blue_excess] = np.clip(peak[blue_excess] + 6, 0, 255).astype(np.uint8)
    result[result[..., 3] == 0, :3] = 0
    return result, int((cyan | blue_excess).sum())


def blue_edge_spill_mask(
    rgba: np.ndarray, radius: float = 4.0, blue_threshold: int = 10,
    cyan_threshold: int = 18,
) -> np.ndarray:
    """Select blue-screen residue only inside a narrow visible silhouette band."""
    alpha = rgba[..., 3]
    visible = alpha > 4
    distance = cv2.distanceTransform(visible.astype(np.uint8), cv2.DIST_L2, 3)
    edge = visible & (distance <= radius)
    rgb = rgba[..., :3].astype(np.int16)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    blue_only = blue > np.maximum(red, green) + blue_threshold
    cyan = (green > red + cyan_threshold) & (blue > red + cyan_threshold)
    return edge & (blue_only | cyan)


def replace_blue_edge_spill(
    rgba: np.ndarray, radius: float = 4.0,
) -> tuple[np.ndarray, int]:
    """Neutralize opaque H3 blue fringe RGB at its original luminance.

    Alpha is deliberately unchanged: this repairs matte colour contamination
    without shrinking the sword, armor, fur, or their antialiased silhouette.
    """
    result = rgba.copy()
    contaminated = blue_edge_spill_mask(result, radius=radius)
    count = int(contaminated.sum())
    if count:
        rgb = result[..., :3].astype(np.float32)
        neutral = np.clip(
            np.rint(rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722),
            0, 255,
        ).astype(np.uint8)
        result[contaminated, 0] = neutral[contaminated]
        result[contaminated, 1] = neutral[contaminated]
        result[contaminated, 2] = neutral[contaminated]
    result[result[..., 3] == 0, :3] = 0
    return result, count


def alpha_bbox(rgba: np.ndarray, threshold: int = 12) -> tuple[int, int, int, int]:
    ys, xs = np.where(rgba[..., 3] > threshold)
    if not len(xs):
        raise RuntimeError("Empty cutout frame")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def body_bbox(rgba: np.ndarray) -> tuple[int, int, int, int]:
    mask = (rgba[..., 3] > 32).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (BODY_OPEN_KERNEL, BODY_OPEN_KERNEL))
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    if count <= 1:
        raise RuntimeError("Body morphology removed every component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    ys, xs = np.where(labels == largest)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def stable_body_bottom(rgba: np.ndarray, kernel_size: int = 13) -> int:
    """Measure the connected armored body/boots while rejecting the thin sword."""
    mask = (rgba[..., 3] > 32).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    count, _, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    if count <= 1:
        raise RuntimeError("Body-bottom morphology removed every component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return int(stats[largest, cv2.CC_STAT_TOP] + stats[largest, cv2.CC_STAT_HEIGHT] - 1)


def torso_anchor_x(rgba: np.ndarray) -> float:
    x0, y0, x1, y1 = body_bbox(rgba)
    top = y0 + round((y1 - y0 + 1) * 0.20)
    bottom = y0 + round((y1 - y0 + 1) * 0.68)
    _, xs = np.where(rgba[top:bottom + 1, :, 3] > 32)
    return float(np.median(xs)) if len(xs) else (x0 + x1) / 2.0


def quantized(value: float, minimum: int = 192) -> int:
    return max(minimum, int(math.ceil(value / CELL_QUANTUM) * CELL_QUANTUM))


def fixed_layout(frames: list[np.ndarray], scale: float) -> tuple[int, int, float, float, int]:
    anchor_x = float(np.median([torso_anchor_x(frame) for frame in frames]))
    # A constant source-space ground anchor preserves generated root/bob/fall motion.
    anchor_y = float(np.median([body_bbox(frame)[3] for frame in frames[:min(3, len(frames))]]))
    left = right = top = bottom = 0.0
    for frame in frames:
        x0, y0, x1, y1 = alpha_bbox(frame)
        left = max(left, (anchor_x - x0) * scale)
        right = max(right, (x1 + 1 - anchor_x) * scale)
        top = max(top, (anchor_y - y0) * scale)
        bottom = max(bottom, (y1 + 1 - anchor_y) * scale)
    # Phaser anchors every cell at its center, so keep the torso anchor at the
    # exact cell center even when the sword makes one side much wider.
    frame_width = quantized(max(left, right) * 2 + MARGIN * 2)
    frame_height = quantized(top + bottom + MARGIN * 2)
    foot_y = int(round(MARGIN + top))
    return frame_width, frame_height, anchor_x, anchor_y, foot_y


def place_fixed(
    rgba: np.ndarray, scale: float, frame_width: int, frame_height: int,
    anchor_x: float, anchor_y: float, foot_y: int,
) -> np.ndarray:
    x0, y0, x1, y1 = alpha_bbox(rgba)
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(Image.fromarray(crop, "RGBA").resize((width, height), Image.Resampling.LANCZOS)).copy()
    resized[resized[..., 3] == 0, :3] = 0
    offset_x = round(frame_width / 2 + (x0 - anchor_x) * scale)
    offset_y = round(foot_y + (y0 - anchor_y) * scale)
    if offset_x < 0 or offset_y < 0 or offset_x + width > frame_width or offset_y + height > frame_height:
        raise RuntimeError(
            f"Fixed placement clips: {width}x{height} at {offset_x},{offset_y} "
            f"inside {frame_width}x{frame_height}"
        )
    cell = np.zeros((frame_height, frame_width, 4), np.uint8)
    cell[offset_y:offset_y + height, offset_x:offset_x + width] = resized
    return cell


def compose(cells: list[np.ndarray], cols: int) -> np.ndarray:
    frame_height, frame_width = cells[0].shape[:2]
    rows = math.ceil(len(cells) / cols)
    sheet = np.zeros((rows * frame_height, cols * frame_width, 4), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[row * frame_height:(row + 1) * frame_height,
              col * frame_width:(col + 1) * frame_width] = cell
    return sheet


def checker(cell: np.ndarray) -> Image.Image:
    yy, xx = np.indices(cell.shape[:2])
    shade = np.where(((xx // 20 + yy // 20) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = cell[..., 3:4].astype(np.float32) / 255.0
    rgb = cell[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def save_source_previews(spec: ActionSpec, cells: list[np.ndarray], output_dir: Path) -> None:
    display_width = 480
    display_height = round(cells[0].shape[0] * display_width / cells[0].shape[1])
    frames = [checker(cell).resize((display_width, display_height), Image.Resampling.LANCZOS) for cell in cells]
    duration = max(20, round(1000 / spec.source_sheet_fps))
    playback = frames if spec.repeat == 0 else frames * 3
    durations = [duration] * len(playback)
    if spec.repeat == 0:
        durations[-1] = max(500, durations[-1])
    playback[0].save(
        output_dir / f"{spec.name}-source.gif", save_all=True,
        append_images=playback[1:], duration=durations, loop=0, disposal=2, optimize=False,
    )

    thumb_w = 240
    thumb_h = round(cells[0].shape[0] * thumb_w / cells[0].shape[1])
    cols = 4
    rows = math.ceil(len(cells) / cols)
    contact = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + 24)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for position, (cell, source_index) in enumerate(zip(cells, spec.indices)):
        row, col = divmod(position, cols)
        x = col * thumb_w
        y = row * (thumb_h + 24)
        contact.paste(checker(cell).resize((thumb_w, thumb_h), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 5, y + thumb_h + 4), f"key {position} / H3 f{source_index}", fill="white")
    contact.save(output_dir / f"{spec.name}-source-contact.png")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--action",
        action="append",
        choices=tuple(spec.name for spec in SPECS),
        help="rebuild only the named action; may be repeated",
    )
    args = parser.parse_args()
    selected = set(args.action or ())
    selected_specs = tuple(spec for spec in SPECS if not selected or spec.name in selected)

    video_dir = ROOT / "videos"
    source_dir = ROOT / "runtime-source-sheets-pre-rife"
    cutout_dir = ROOT / "runtime-cutouts"
    preview_dir = ROOT / "previews" / "runtime-source"
    source_dir.mkdir(parents=True, exist_ok=True)
    cutout_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)

    decoded = {
        spec.name: HELPER.decode_video(video_dir / spec.video_name)
        for spec in selected_specs
    }
    model = None
    cutouts: dict[tuple[str, int], np.ndarray] = {}
    for spec in selected_specs:
        frames, _ = decoded[spec.name]
        action_cutout_dir = cutout_dir / spec.name
        action_cutout_dir.mkdir(parents=True, exist_ok=True)
        for index in spec.indices:
            cache_path = action_cutout_dir / f"f{index:03d}.png"
            if cache_path.exists():
                cutouts[(spec.name, index)] = np.asarray(Image.open(cache_path).convert("RGBA"))
                print(f"[champion-h3] {spec.name} cached f{index}", flush=True)
            else:
                if model is None:
                    model = HELPER.get_model()
                cutouts[(spec.name, index)] = cutout_rgba(frames[index], model)
                Image.fromarray(cutouts[(spec.name, index)], "RGBA").save(
                    cache_path, optimize=True, compress_level=9,
                )
                print(f"[champion-h3] {spec.name} BiRefNet f{index}", flush=True)

    report_path = ROOT / "runtime-source-sheet-report.json"
    existing_report = None
    if selected and report_path.exists():
        existing_report = json.loads(report_path.read_text(encoding="utf-8"))

    source_body_heights: dict[str, float] = dict(
        (existing_report or {}).get("sourceMedianUprightBodyHeightByAction", {})
    )
    scale_by_action: dict[str, float] = dict(
        (existing_report or {}).get("fixedScaleByAction", {})
    )
    for spec in selected_specs:
        if spec.name in LOCKED_LAYOUTS:
            locked = LOCKED_LAYOUTS[spec.name]
            source_body_heights[spec.name] = float(locked["sourceMedianUprightBodyHeight"])
            scale_by_action[spec.name] = float(locked["scale"])
            continue
        # The first four keys are upright in all four approved H3 sources.
        # One median scale per video removes camera-framing drift without any
        # pose-by-pose pumping or trajectory straightening.
        heights = []
        for index in spec.indices[:4]:
            _, body_y0, _, body_y1 = body_bbox(cutouts[(spec.name, index)])
            heights.append(body_y1 - body_y0 + 1)
        source_body_heights[spec.name] = float(np.median(heights))
        scale_by_action[spec.name] = TARGET_BODY_HEIGHT / source_body_heights[spec.name]
    report: dict[str, object] = existing_report or {
        "runtimeIntegration": True,
        "source": "approved MiniMax H3 videos",
        "fixedTransformWithinEachAction": True,
        "targetEffectiveBodyHeight": TARGET_BODY_HEIGHT,
        "scaleContract": "one fixed scale per H3 camera, all normalized to the same effective upright body height",
        "sourceMedianUprightBodyHeightByAction": source_body_heights,
        "fixedScaleByAction": scale_by_action,
        "actions": {},
    }
    report["runtimeIntegration"] = True
    report["sourceMedianUprightBodyHeightByAction"] = source_body_heights
    report["fixedScaleByAction"] = scale_by_action

    for spec in selected_specs:
        rgba_frames = [cutouts[(spec.name, index)] for index in spec.indices]
        blue_spill_repairs = [0] * len(rgba_frames)
        if spec.name == "running":
            repaired_frames = []
            for position, frame in enumerate(rgba_frames):
                repaired, repair_count = despill_blue_chroma(frame)
                repaired, edge_repair_count = replace_blue_edge_spill(repaired, radius=4.0)
                repaired_frames.append(repaired)
                blue_spill_repairs[position] = repair_count + edge_repair_count
            rgba_frames = repaired_frames
        else:
            repaired_frames = []
            for position, frame in enumerate(rgba_frames):
                repaired, repair_count = replace_blue_edge_spill(frame, radius=4.0)
                repaired_frames.append(repaired)
                blue_spill_repairs[position] = repair_count
            rgba_frames = repaired_frames
        action_scale = scale_by_action[spec.name]
        if spec.name in LOCKED_LAYOUTS:
            locked = LOCKED_LAYOUTS[spec.name]
            frame_width = int(locked["frameWidth"])
            frame_height = int(locked["frameHeight"])
            anchor_x = float(locked["anchorX"])
            anchor_y = float(locked["anchorY"])
            foot_y = int(locked["footY"])
            layout_source = "locked existing runtime attack layout"
        else:
            frame_width, frame_height, anchor_x, anchor_y, foot_y = fixed_layout(
                rgba_frames, action_scale,
            )
            layout_source = "computed fixed action layout"
        if frame_width > 1024 or frame_height > 512:
            raise RuntimeError(f"{spec.name} needs unsupported cell {frame_width}x{frame_height}")
        cols = min(8, max(1, 8192 // frame_width))
        cells = [
            place_fixed(frame, action_scale, frame_width, frame_height, anchor_x, anchor_y, foot_y)
            for frame in rgba_frames
        ]
        placed_blue_spill_repairs = [0] * len(cells)
        repaired_cells = []
        for position, cell in enumerate(cells):
            repaired, repair_count = replace_blue_edge_spill(cell, radius=2.0)
            repaired_cells.append(repaired)
            placed_blue_spill_repairs[position] = repair_count
        cells = repaired_cells
        Image.fromarray(compose(cells, cols), "RGBA").save(
            source_dir / f"{spec.name}.png", optimize=True, compress_level=9,
        )
        save_source_previews(spec, cells, preview_dir)
        validation = HELPER.validate_cells(cells, spec.repeat)
        body_bottoms = [stable_body_bottom(cell) for cell in cells]
        validation["stableBodyBottomOpenKernel"] = 13
        validation["stableBodyBottomMin"] = min(body_bottoms)
        validation["stableBodyBottomMax"] = max(body_bottoms)
        validation["stableBodyBottomByFrame"] = body_bottoms
        validation["alphaBottomMayIncludeWeapon"] = True
        validation["remainingBlueEdgeSpillByFrame"] = [
            int(blue_edge_spill_mask(cell, radius=2.0).sum()) for cell in cells
        ]
        validation["remainingBlueEdgeSpillTotal"] = sum(
            validation["remainingBlueEdgeSpillByFrame"]
        )
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        )
        if spec.interpolation_mode == "native-source":
            final_count = len(cells)
        else:
            final_count = len(cells) * 2 if spec.repeat == -1 else len(cells) * 2 - 1
        decoded_bytes = final_count * frame_width * frame_height * 4
        report["actions"][spec.name] = {
            "configKey": spec.config_key,
            "source": f"videos/{spec.video_name}",
            "sourceFrameRate": decoded[spec.name][1],
            "sourceIndices": list(spec.indices),
            "sourceFrameCount": len(cells),
            "finalFrameCount": final_count,
            "frameWidth": frame_width,
            "frameHeight": frame_height,
            "cols": cols,
            "sourceRows": math.ceil(len(cells) / cols),
            "sourceSheetFrameRate": spec.source_sheet_fps,
            "runtimeFrameRate": spec.runtime_fps,
            "repeat": spec.repeat,
            "interpolationMode": spec.interpolation_mode,
            "layoutSource": layout_source,
            "footY": foot_y,
            "fixedSourceAnchor": {"x": anchor_x, "y": anchor_y},
            "fixedActionScale": action_scale,
            "decodedBytes": decoded_bytes,
            "decodedMiB": decoded_bytes / (1024 ** 2),
            "preserveVerticalMotionDuringRife": spec.preserve_vertical_motion,
            "sourceBlueSpillPixelsRepaired": blue_spill_repairs,
            "placedBlueSpillPixelsRepaired": placed_blue_spill_repairs,
            "blueEdgeCleanup": (
                "blue/cyan edge RGB neutralized at the same luminance; source radius "
                "4px, placed radius 2px; alpha unchanged"
            ),
            "validation": validation,
        }
    total_decoded_bytes = sum(
        int(action["decodedBytes"]) for action in report["actions"].values()
    )
    report["totalDecodedBytes"] = total_decoded_bytes
    report["totalDecodedMiB"] = total_decoded_bytes / (1024 ** 2)
    report["crowdBudgetMiB"] = 64
    report["withinCrowdBudget"] = total_decoded_bytes <= 64 * 1024 ** 2
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    if not report["withinCrowdBudget"]:
        raise RuntimeError(f"Decoded sprite budget {report['totalDecodedMiB']:.2f} MiB exceeds 64 MiB")


if __name__ == "__main__":
    main()
