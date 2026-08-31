#!/usr/bin/env python3
"""RIFE v4.6 2x interpolation for one transparent character sprite sheet.

RGB and alpha are interpolated separately because rife-ncnn-vulkan does not
preserve alpha. Transparent RGB is filled from the nearest visible pixel before
RIFE to prevent dark edge halos. Original key-frame pixels remain unchanged at
even output indices after transparent-RGB normalization. Looping actions include
the last-to-first seam (N -> 2N); one-shot
actions never wrap (N -> 2N-1). Grounded characters align generated middle-frame
alpha bottoms by default; flying/falling actions can preserve native vertical motion.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


REPO = Path(__file__).resolve().parents[2]
DEFAULT_RIFE = (
    REPO.parent
    / "_tmp"
    / "elise_audit"
    / "rife"
    / "rife-ncnn-vulkan-20221029-windows"
    / "rife-ncnn-vulkan.exe"
)
MODEL = "rife-v4.6"
PIPELINE_VERSION = "rife-v4.6-rgba-v8-exact-half-step"
VISIBLE_DARK_ALPHA = 96
VISIBLE_DARK_MAX_RGB = 24
VISIBLE_DARK_DILATION = 12
VISIBLE_DARK_REPAIR_MIN_PIXELS = 8
VISIBLE_RED_ALPHA = 96
VISIBLE_RED_MIN_R = 80
VISIBLE_RED_EXCESS = 55
VISIBLE_RED_NEIGHBOURHOOD = 31
VISIBLE_RED_EXCESS_MARGIN = 20
VISIBLE_RED_REPAIR_MIN_PIXELS = 6
VISIBLE_MAGENTA_MIN_CHANNEL = 70
VISIBLE_MAGENTA_EXCESS = 45
VISIBLE_MAGENTA_EXCESS_MARGIN = 20
LARGE_DARK_REPAIR_HOLD_PIXELS = 1000
LARGE_RED_REPAIR_HOLD_PIXELS = 100


def extract_cells(
    path: Path, frame_width: int, frame_height: int, cols: int, count: int
) -> list[np.ndarray]:
    with Image.open(path) as source_image:
        sheet = np.asarray(source_image.convert("RGBA")).copy()
    rows = math.ceil(count / cols)
    expected_width = cols * frame_width
    expected_height = rows * frame_height
    if sheet.shape[1] < expected_width or sheet.shape[0] < expected_height:
        raise SystemExit(
            f"{path}: sheet {sheet.shape[1]}x{sheet.shape[0]} cannot contain "
            f"{count} frames in {cols} cols of {frame_width}x{frame_height}"
        )
    cells = []
    for index in range(count):
        row, col = divmod(index, cols)
        cell = sheet[
                row * frame_height:(row + 1) * frame_height,
                col * frame_width:(col + 1) * frame_width,
            ].copy()
        # Raw legacy sheets may carry arbitrary hidden RGB under alpha=0.
        # Keep the untouched raw sheet in --backup, but normalize formal keys
        # before interpolation so transparent-RGB validation is meaningful.
        cell[cell[..., 3] == 0, :3] = 0
        cells.append(cell)
    return cells


def bleed_rgb(frame: np.ndarray) -> np.ndarray:
    """Fill transparent RGB with the nearest visible color before interpolation."""
    opaque = frame[..., 3] > 8
    if not opaque.any():
        return np.zeros(frame.shape[:2] + (3,), dtype=np.uint8)
    if opaque.all():
        return frame[..., :3].copy()
    _, indices = ndimage.distance_transform_edt(~opaque, return_indices=True)
    return frame[..., :3][indices[0], indices[1]].astype(np.uint8)


def repair_blue_spill(frame: np.ndarray, threshold: int = 18) -> tuple[np.ndarray, int]:
    """Remove blue/cyan chroma excess introduced only by an interpolated frame."""
    result = frame.copy()
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
        result[..., 2][blue_excess] = np.clip(
            peak[blue_excess] + 6, 0, 255
        ).astype(np.uint8)
    result[result[..., 3] == 0, :3] = 0
    return result, int((cyan | blue_excess).sum())


def visible_blue_spill(frame: np.ndarray, threshold: int) -> tuple[int, int]:
    """Count remaining blue-only and cyan pixels that still carry visible alpha."""
    rgb = frame[..., :3].astype(np.int16)
    alpha = frame[..., 3]
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    blue_only = (alpha > 3) & (blue > np.maximum(red, green) + threshold)
    cyan = (
        (alpha > 3)
        & (green > red + threshold)
        & (blue > red + threshold)
    )
    return int(blue_only.sum()), int(cyan.sum())


def repair_large_magenta_components(
    frame: np.ndarray, minimum_component_pixels: int = 64
) -> tuple[np.ndarray, int]:
    """Replace large generated purple blocks while retaining tiny source details."""
    result = frame.copy()
    rgb = result[..., :3].astype(np.int16)
    alpha = result[..., 3]
    suspect = (
        (alpha > VISIBLE_RED_ALPHA)
        & (rgb[..., 0] > VISIBLE_MAGENTA_MIN_CHANNEL)
        & (rgb[..., 2] > VISIBLE_MAGENTA_MIN_CHANNEL)
        & (np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1] > 35)
    )
    labels, component_count = ndimage.label(suspect)
    repair = np.zeros_like(suspect)
    for label_index in range(1, component_count + 1):
        component = labels == label_index
        if int(component.sum()) >= minimum_component_pixels:
            repair |= component
    count = int(repair.sum())
    if count == 0:
        return result, 0
    valid = (alpha > 8) & ~suspect
    if not valid.any():
        return result, 0
    _, indices = ndimage.distance_transform_edt(~valid, return_indices=True)
    ys, xs = np.where(repair)
    result[ys, xs, :3] = result[indices[0, ys, xs], indices[1, ys, xs], :3]
    return result, count


def run_rife(rife: Path, first: Path, second: Path, output: Path) -> None:
    subprocess.run(
        [str(rife), "-0", str(first), "-1", str(second), "-o", str(output), "-m", MODEL],
        check=True,
        capture_output=True,
        timeout=180,
    )


def run_rife_sequence(
    rife: Path, input_dir: Path, output_dir: Path, target_count: int
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            str(rife), "-i", str(input_dir), "-o", str(output_dir),
            "-n", str(target_count), "-m", MODEL,
        ],
        check=True,
        capture_output=True,
        timeout=max(180, target_count * 20),
    )


def alpha_bbox(frame: np.ndarray, threshold: int = 16) -> tuple[int, int, int, int] | None:
    ys, xs = np.where(frame[..., 3] > threshold)
    if not xs.size:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def alpha_bottom(frame: np.ndarray) -> int | None:
    bbox = alpha_bbox(frame, 32)
    return bbox[3] if bbox else None


def shift_vertical(frame: np.ndarray, dy: int) -> np.ndarray:
    if dy == 0:
        return frame
    bbox = alpha_bbox(frame, 8)
    if not bbox:
        return frame
    _, top, _, bottom = bbox
    height = frame.shape[0]
    dy = max(-top, min(height - 1 - bottom, dy))
    moved = np.zeros_like(frame)
    if dy > 0:
        moved[dy:] = frame[:height - dy]
    elif dy < 0:
        moved[:height + dy] = frame[-dy:]
    else:
        return frame
    return moved


def visible_dark_mask(frame: np.ndarray) -> np.ndarray:
    """Opaque near-black pixels that can produce one-frame black flashes."""
    return (
        (frame[..., 3] > VISIBLE_DARK_ALPHA)
        & (frame[..., :3].max(axis=2) < VISIBLE_DARK_MAX_RGB)
    )


def temporal_dark_outlier_mask(
    middle: np.ndarray, first: np.ndarray, second: np.ndarray
) -> np.ndarray:
    """Find dark pixels invented away from dark detail in both source keys."""
    neighbour_dark = visible_dark_mask(first) | visible_dark_mask(second)
    allowed_dark = ndimage.binary_dilation(
        neighbour_dark, iterations=VISIBLE_DARK_DILATION
    )
    return visible_dark_mask(middle) & ~allowed_dark


def repair_temporal_dark_outliers(
    middle: np.ndarray, first: np.ndarray, second: np.ndarray
) -> tuple[np.ndarray, int, bool]:
    """Replace sizeable invented black blobs with the nearest valid middle color."""
    outliers = temporal_dark_outlier_mask(middle, first, second)
    count = int(outliers.sum())
    if count < VISIBLE_DARK_REPAIR_MIN_PIXELS:
        return middle, 0, False
    # Reconstruct suspect pixels from both nearest-color-filled source keys.
    # This retains a true half-step even for fast-moving dark armour/legs; a
    # blanket hold would remove the flash but turn most inserted frames into
    # duplicates on large cavalry sprites.
    source_rgb = np.rint(
        (
            bleed_rgb(first).astype(np.float32)
            + bleed_rgb(second).astype(np.float32)
        )
        * 0.5
    ).astype(np.uint8)
    repaired = middle.copy()
    ys, xs = np.where(outliers)
    repaired[ys, xs, :3] = source_rgb[ys, xs]

    # If both nearest-color fields still collapse to near-black, sample the
    # nearest valid colour already present in the interpolated silhouette.
    still_dark = outliers & (
        repaired[..., :3].max(axis=2) < VISIBLE_DARK_MAX_RGB
    )
    if not still_dark.any():
        return repaired, count, False
    valid = (
        (middle[..., 3] > 8)
        & (middle[..., :3].max(axis=2) >= VISIBLE_DARK_MAX_RGB)
    )
    if not valid.any():
        return first.copy(), count, True
    _, indices = ndimage.distance_transform_edt(~valid, return_indices=True)
    ys, xs = np.where(still_dark)
    source_ys = indices[0, ys, xs]
    source_xs = indices[1, ys, xs]
    repaired[ys, xs, :3] = middle[source_ys, source_xs, :3]
    return repaired, count, False


def red_excess(frame: np.ndarray) -> np.ndarray:
    """How strongly red dominates green/blue at each pixel."""
    rgb = frame[..., :3].astype(np.int16)
    return rgb[..., 0] - np.maximum(rgb[..., 1], rgb[..., 2])


def magenta_excess(frame: np.ndarray) -> np.ndarray:
    """How strongly red and blue jointly exceed green at each pixel."""
    rgb = frame[..., :3].astype(np.int16)
    return np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]


def temporal_red_outlier_mask(
    middle: np.ndarray, first: np.ndarray, second: np.ndarray
) -> np.ndarray:
    """Find red chroma invented beyond either neighbouring source key."""
    first_excess = np.where(first[..., 3] > 8, red_excess(first), 0)
    second_excess = np.where(second[..., 3] > 8, red_excess(second), 0)
    allowed_excess = np.maximum(
        ndimage.maximum_filter(first_excess, size=VISIBLE_RED_NEIGHBOURHOOD),
        ndimage.maximum_filter(second_excess, size=VISIBLE_RED_NEIGHBOURHOOD),
    )
    middle_excess = red_excess(middle)
    red_outlier = (
        (middle[..., 3] > VISIBLE_RED_ALPHA)
        & (middle[..., 0] > VISIBLE_RED_MIN_R)
        & (middle_excess > VISIBLE_RED_EXCESS)
        & (middle_excess > allowed_excess + VISIBLE_RED_EXCESS_MARGIN)
    )
    first_magenta = np.where(first[..., 3] > 8, magenta_excess(first), 0)
    second_magenta = np.where(second[..., 3] > 8, magenta_excess(second), 0)
    allowed_magenta = np.maximum(
        ndimage.maximum_filter(first_magenta, size=VISIBLE_RED_NEIGHBOURHOOD),
        ndimage.maximum_filter(second_magenta, size=VISIBLE_RED_NEIGHBOURHOOD),
    )
    middle_magenta = magenta_excess(middle)
    magenta_outlier = (
        (middle[..., 3] > VISIBLE_RED_ALPHA)
        & (middle[..., 0] > VISIBLE_MAGENTA_MIN_CHANNEL)
        & (middle[..., 2] > VISIBLE_MAGENTA_MIN_CHANNEL)
        & (middle_magenta > VISIBLE_MAGENTA_EXCESS)
        & (middle_magenta > allowed_magenta + VISIBLE_MAGENTA_EXCESS_MARGIN)
    )
    return red_outlier | magenta_outlier


def repair_temporal_red_outliers(
    middle: np.ndarray, first: np.ndarray, second: np.ndarray
) -> tuple[np.ndarray, int]:
    """Replace unsupported RIFE red blocks from the nearest valid texture."""
    outliers = temporal_red_outlier_mask(middle, first, second)
    count = int(outliers.sum())
    if count < VISIBLE_RED_REPAIR_MIN_PIXELS:
        return middle, 0

    repaired = middle.copy()
    source_rgb = np.rint(
        (
            bleed_rgb(first).astype(np.float32)
            + bleed_rgb(second).astype(np.float32)
        )
        * 0.5
    ).astype(np.uint8)
    ys, xs = np.where(outliers)
    repaired[ys, xs, :3] = source_rgb[ys, xs]
    residual = temporal_red_outlier_mask(repaired, first, second)
    if residual.any():
        first_excess = np.where(first[..., 3] > 8, red_excess(first), 0)
        second_excess = np.where(second[..., 3] > 8, red_excess(second), 0)
        allowed_excess = np.maximum(
            ndimage.maximum_filter(first_excess, size=VISIBLE_RED_NEIGHBOURHOOD),
            ndimage.maximum_filter(second_excess, size=VISIBLE_RED_NEIGHBOURHOOD),
        )
        base = np.maximum(repaired[..., 1], repaired[..., 2]).astype(np.int16)
        permitted = np.minimum(
            VISIBLE_RED_EXCESS,
            allowed_excess + VISIBLE_RED_EXCESS_MARGIN,
        )
        red_limit = np.clip(base + permitted, 0, 255).astype(np.uint8)
        repaired[..., 0][residual] = np.minimum(
            repaired[..., 0][residual], red_limit[residual]
        )
    return repaired, count


def assemble_middle(
    first: np.ndarray, second: np.ndarray, middle_rgb: Path, middle_alpha: Path,
    repair_red_outliers: bool, hold_large_repair: bool, align_alpha_bottom: bool,
) -> tuple[np.ndarray, int, int, int, bool]:
    rgb = np.asarray(Image.open(middle_rgb).convert("RGB")).copy()
    alpha = np.asarray(Image.open(middle_alpha).convert("L")).copy()
    alpha[alpha <= 2] = 0
    rgb[alpha == 0] = 0
    middle = np.dstack([rgb, alpha])

    current = alpha_bottom(middle)
    first_bottom = alpha_bottom(first)
    second_bottom = alpha_bottom(second)
    dy = 0
    if align_alpha_bottom and current is not None and first_bottom is not None and second_bottom is not None:
        target = round((first_bottom + second_bottom) / 2)
        dy = target - current
        middle = shift_vertical(middle, dy)
    middle, repaired_dark_pixels, held_source_key = repair_temporal_dark_outliers(
        middle, first, second
    )
    repaired_red_pixels = 0
    if repair_red_outliers:
        middle, repaired_red_pixels = repair_temporal_red_outliers(
            middle, first, second
        )
    if hold_large_repair and (
        repaired_dark_pixels >= LARGE_DARK_REPAIR_HOLD_PIXELS
        or repaired_red_pixels >= LARGE_RED_REPAIR_HOLD_PIXELS
    ):
        middle = first.copy()
        held_source_key = True
    middle[middle[..., 3] == 0, :3] = 0
    return middle, dy, repaired_dark_pixels, repaired_red_pixels, held_source_key


def interpolate_pair(
    first: np.ndarray, second: np.ndarray, pair_dir: Path, rife: Path,
    repair_red_outliers: bool, hold_large_repair: bool, align_alpha_bottom: bool,
) -> tuple[np.ndarray, int, int, int, bool]:
    pair_dir.mkdir(parents=True, exist_ok=True)
    first_rgb = pair_dir / "first-rgb.png"
    second_rgb = pair_dir / "second-rgb.png"
    first_alpha = pair_dir / "first-alpha.png"
    second_alpha = pair_dir / "second-alpha.png"
    middle_rgb = pair_dir / "middle-rgb.png"
    middle_alpha = pair_dir / "middle-alpha.png"
    Image.fromarray(bleed_rgb(first), "RGB").save(first_rgb)
    Image.fromarray(bleed_rgb(second), "RGB").save(second_rgb)
    Image.fromarray(first[..., 3], "L").save(first_alpha)
    Image.fromarray(second[..., 3], "L").save(second_alpha)
    run_rife(rife, first_rgb, second_rgb, middle_rgb)
    run_rife(rife, first_alpha, second_alpha, middle_alpha)
    return assemble_middle(
        first, second, middle_rgb, middle_alpha,
        repair_red_outliers, hold_large_repair, align_alpha_bottom,
    )


def interpolate(
    originals: list[np.ndarray], mode: str, work_dir: Path, rife: Path,
    loop_start_index: int = 0, repair_red_outliers: bool = False,
    hold_large_repair: bool = False, align_alpha_bottom: bool = True,
) -> tuple[list[np.ndarray], list[int], list[int], list[int], list[bool]]:
    pair_count = len(originals) if mode == "loop" else len(originals) - 1
    frames: list[np.ndarray] = []
    shifts: list[int] = []
    dark_repairs: list[int] = []
    red_repairs: list[int] = []
    held_source_keys: list[bool] = []

    rgb_input = work_dir / "sequence-rgb-input"
    alpha_input = work_dir / "sequence-alpha-input"
    rgb_output = work_dir / "sequence-rgb-output"
    alpha_output = work_dir / "sequence-alpha-output"
    rgb_input.mkdir(parents=True, exist_ok=True)
    alpha_input.mkdir(parents=True, exist_ok=True)
    for index, original in enumerate(originals):
        Image.fromarray(bleed_rgb(original), "RGB").save(
            rgb_input / f"{index:08d}.png"
        )
        Image.fromarray(original[..., 3], "L").save(
            alpha_input / f"{index:08d}.png"
        )
    # ncnn directory mode samples at i * input_count / output_count, NOT
    # i * (input_count - 1) / (output_count - 1). Request 2N so even filenames
    # are exact t=0.5 half-steps. 2N-1 drifts toward t=1 and causes late stutter.
    # Ignore its duplicate tail; one-shots still assemble 2N-1 real frames,
    # while loops generate their final wrap midpoint separately below.
    sequence_count = len(originals) * 2
    run_rife_sequence(rife, rgb_input, rgb_output, sequence_count)
    run_rife_sequence(rife, alpha_input, alpha_output, sequence_count)

    for index in range(pair_count):
        next_index = index + 1
        if next_index >= len(originals):
            next_index = loop_start_index
        if index < len(originals) - 1:
            # Directory mode numbers outputs from 1. With 2N outputs, even
            # filenames are the half-step frames between adjacent source keys.
            output_number = index * 2 + 2
            middle, dy, repaired_dark_pixels, repaired_red_pixels, held_source_key = assemble_middle(
                originals[index], originals[next_index],
                rgb_output / f"{output_number:08d}.png",
                alpha_output / f"{output_number:08d}.png",
                repair_red_outliers,
                hold_large_repair,
                align_alpha_bottom,
            )
        else:
            middle, dy, repaired_dark_pixels, repaired_red_pixels, held_source_key = interpolate_pair(
                originals[index], originals[next_index],
                work_dir / f"pair-{index:03d}", rife,
                repair_red_outliers,
                hold_large_repair,
                align_alpha_bottom,
            )
        frames.extend([originals[index], middle])
        shifts.append(dy)
        dark_repairs.append(repaired_dark_pixels)
        red_repairs.append(repaired_red_pixels)
        held_source_keys.append(held_source_key)
        print(
            f"[rife-sheet] pair {index + 1}/{pair_count} "
            f"source={index}->{next_index} foot_dy={dy} "
            f"dark_repaired={repaired_dark_pixels} "
            f"red_repaired={repaired_red_pixels} "
            f"hold_fallback={held_source_key}",
            flush=True,
        )
    if mode == "one-shot":
        frames.append(originals[-1])
    return frames, shifts, dark_repairs, red_repairs, held_source_keys


def compose(frames: list[np.ndarray], cols: int) -> np.ndarray:
    frame_height, frame_width = frames[0].shape[:2]
    rows = math.ceil(len(frames) / cols)
    sheet = np.zeros((rows * frame_height, cols * frame_width, 4), dtype=np.uint8)
    for index, frame in enumerate(frames):
        row, col = divmod(index, cols)
        sheet[
            row * frame_height:(row + 1) * frame_height,
            col * frame_width:(col + 1) * frame_width,
        ] = frame
    return sheet


def checker(frame: np.ndarray) -> Image.Image:
    yy, xx = np.indices(frame.shape[:2])
    shade = np.where(((xx // 24 + yy // 24) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = frame[..., 3:4].astype(np.float32) / 255.0
    rgb = frame[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def write_previews(
    name: str,
    frames: list[np.ndarray],
    source_frame_rate: float,
    mode: str,
    preview_dir: Path,
) -> None:
    preview_dir.mkdir(parents=True, exist_ok=True)
    source_height, source_width = frames[0].shape[:2]
    width = 384
    height = round(source_height * width / source_width)
    gif_frames = [
        checker(frame).resize((width, height), Image.Resampling.LANCZOS) for frame in frames
    ]
    frame_ms = max(20, round(1000 / (source_frame_rate * 2)))
    durations = [frame_ms] * len(gif_frames)
    if mode == "one-shot":
        durations[0] = max(250, durations[0])
        durations[-1] = max(650, durations[-1])
    gif_frames[0].save(
        preview_dir / f"{name}-interpolated.gif",
        save_all=True,
        append_images=gif_frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        optimize=False,
    )

    thumb_width = 160
    thumb_height = max(1, round(source_height * thumb_width / source_width))
    label_height = 22
    cols = 8
    rows = math.ceil(len(frames) / cols)
    contact = Image.new(
        "RGB", (cols * thumb_width, rows * (thumb_height + label_height)), "#20242a"
    )
    draw = ImageDraw.Draw(contact)
    for index, frame in enumerate(frames):
        preview = checker(frame).resize(
            (thumb_width, thumb_height), Image.Resampling.LANCZOS
        )
        x = (index % cols) * thumb_width
        y = (index // cols) * (thumb_height + label_height)
        contact.paste(preview, (x, y))
        kind = "key" if index % 2 == 0 else "RIFE"
        draw.text((x + 4, y + thumb_height + 3), f"f{index} {kind}", fill="white")
    contact.save(preview_dir / f"{name}-interpolated-contact.png")


def frame_delta(first: np.ndarray, second: np.ndarray) -> float:
    mask = (first[..., 3] > 10) | (second[..., 3] > 10)
    if not mask.any():
        return 0.0
    return float(np.abs(first.astype(np.float32) - second)[mask].mean())


def adjacent_mean(
    frames: list[np.ndarray], mode: str, loop_return_index: int = 0
) -> float:
    pairs = list(zip(frames, frames[1:]))
    if mode == "loop":
        pairs.append((frames[-1], frames[loop_return_index]))
    return float(np.mean([frame_delta(first, second) for first, second in pairs]))


def validate(
    originals: list[np.ndarray], frames: list[np.ndarray], mode: str,
    shifts: list[int], dark_repairs: list[int], red_repairs: list[int],
    held_source_keys: list[bool], repair_red_outliers: bool,
    loop_start_index: int, validate_blue_spill: bool, blue_spill_threshold: int,
) -> dict[str, object]:
    bboxes = [alpha_bbox(frame) for frame in frames]
    empty = [index for index, bbox in enumerate(bboxes) if bbox is None]
    touching = [
        index
        for index, bbox in enumerate(bboxes)
        if bbox is not None
        and (
            bbox[0] <= 2
            or bbox[1] <= 2
            or bbox[2] >= frames[index].shape[1] - 3
            or bbox[3] >= frames[index].shape[0] - 3
        )
    ]
    bottoms = [alpha_bottom(frame) for frame in frames]
    originals_preserved = all(
        np.array_equal(original, frames[index * 2])
        for index, original in enumerate(originals)
    )
    transparent_rgb = max(
        int(np.count_nonzero(frame[..., :3][frame[..., 3] == 0])) for frame in frames
    )
    remaining_dark_outliers: dict[int, int] = {}
    remaining_red_outliers: dict[int, int] = {}
    remaining_blue_spill: dict[int, int] = {}
    remaining_cyan_spill: dict[int, int] = {}
    if validate_blue_spill:
        for index, frame in enumerate(frames):
            blue_count, cyan_count = visible_blue_spill(frame, blue_spill_threshold)
            if blue_count:
                remaining_blue_spill[index] = blue_count
            if cyan_count:
                remaining_cyan_spill[index] = cyan_count
    pair_count = len(originals) if mode == "loop" else len(originals) - 1
    for index in range(pair_count):
        next_index = index + 1
        if next_index >= len(originals):
            next_index = loop_start_index
        count = int(
            temporal_dark_outlier_mask(
                frames[index * 2 + 1], originals[index], originals[next_index]
            ).sum()
        )
        if count >= VISIBLE_DARK_REPAIR_MIN_PIXELS:
            remaining_dark_outliers[index * 2 + 1] = count
        if repair_red_outliers:
            red_count = int(
                temporal_red_outlier_mask(
                    frames[index * 2 + 1], originals[index], originals[next_index]
                ).sum()
            )
            if red_count >= VISIBLE_RED_REPAIR_MIN_PIXELS:
                remaining_red_outliers[index * 2 + 1] = red_count
    return {
        "emptyFrames": empty,
        "touchingFrames": touching,
        "alphaBottomMin": min(value for value in bottoms if value is not None),
        "alphaBottomMax": max(value for value in bottoms if value is not None),
        "middleFrameFootShifts": shifts,
        "middleFrameVisibleDarkPixelsRepaired": dark_repairs,
        "middleFrameVisibleRedPixelsRepaired": red_repairs,
        "middleFrameHeldSourceKeyFallbacks": [
            index * 2 + 1 for index, held in enumerate(held_source_keys) if held
        ],
        "visibleDarkOutlierFrames": remaining_dark_outliers,
        "visibleRedOutlierFrames": remaining_red_outliers,
        "visibleBlueSpillFrames": remaining_blue_spill,
        "visibleCyanSpillFrames": remaining_cyan_spill,
        "originalKeyFramesPreservedAtEvenIndices": originals_preserved,
        "nonzeroRgbInTransparentPixels": transparent_rgb,
        "adjacentDeltaMeanBefore": adjacent_mean(
            originals, mode, loop_start_index
        ),
        "adjacentDeltaMeanAfter": adjacent_mean(
            frames, mode, loop_start_index * 2
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--frame-width", type=int, required=True)
    parser.add_argument("--frame-height", type=int, required=True)
    parser.add_argument("--cols", type=int, required=True)
    parser.add_argument("--frame-count", type=int, required=True)
    parser.add_argument("--frame-rate", type=float, required=True)
    parser.add_argument("--mode", choices=("loop", "one-shot"), required=True)
    parser.add_argument("--loop-start-index", type=int, default=0)
    parser.add_argument("--out-cols", type=int, default=8)
    parser.add_argument("--preview-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--rife", type=Path, default=DEFAULT_RIFE)
    parser.add_argument("--repair-red-outliers", action="store_true")
    parser.add_argument("--repair-magenta-middle", action="store_true",
                        help="remove purple/magenta codec blocks from generated odd frames only")
    parser.add_argument("--hold-large-repair", action="store_true")
    parser.add_argument("--preserve-vertical-motion", action="store_true",
                        help="disable grounded alpha-bottom correction for flying/falling actions")
    parser.add_argument("--despill-blue-middle", action="store_true",
                        help="remove blue/cyan chroma excess from generated odd frames only")
    parser.add_argument("--blue-spill-threshold", type=int, default=18)
    args = parser.parse_args()

    if not args.rife.exists():
        raise SystemExit(f"RIFE not found: {args.rife}")
    originals = extract_cells(
        args.sheet, args.frame_width, args.frame_height, args.cols, args.frame_count
    )
    if not 0 <= args.loop_start_index < len(originals):
        raise SystemExit(
            f"loop start {args.loop_start_index} outside 0..{len(originals) - 1}"
        )
    if args.backup:
        args.backup.parent.mkdir(parents=True, exist_ok=True)
        if not args.backup.exists():
            shutil.copy2(args.sheet, args.backup)

    with tempfile.TemporaryDirectory(prefix=f"rife-{args.name}-") as temp:
        frames, shifts, dark_repairs, red_repairs, held_source_keys = interpolate(
            originals, args.mode, Path(temp), args.rife, args.loop_start_index,
            args.repair_red_outliers, args.hold_large_repair,
            not args.preserve_vertical_motion,
        )
    blue_spill_repairs = [0] * len(frames)
    if args.despill_blue_middle:
        for index in range(1, len(frames), 2):
            frames[index], blue_spill_repairs[index] = repair_blue_spill(
                frames[index], args.blue_spill_threshold,
            )
            # Despill can turn unsupported blue/cyan codec residue into an
            # opaque near-black block.  The first dark pass happens before
            # despill, so repeat the temporal gate on the actual final colour.
            pair_index = (index - 1) // 2
            next_index = pair_index + 1
            if next_index >= len(originals):
                next_index = args.loop_start_index
            frames[index], repaired_after_despill, _ = repair_temporal_dark_outliers(
                frames[index], originals[pair_index], originals[next_index]
            )
            dark_repairs[pair_index] += repaired_after_despill
            repaired_large_magenta = 0
            if args.repair_magenta_middle:
                frames[index], repaired_large_magenta = repair_large_magenta_components(
                    frames[index], minimum_component_pixels=64
                )
                red_repairs[pair_index] += repaired_large_magenta
                frames[index], repaired_magenta = repair_large_magenta_components(
                    frames[index], minimum_component_pixels=1
                )
                red_repairs[pair_index] += repaired_magenta
            if args.repair_red_outliers:
                frames[index], repaired_chroma_after_despill = repair_temporal_red_outliers(
                    frames[index], originals[pair_index], originals[next_index]
                )
                red_repairs[pair_index] += repaired_chroma_after_despill
            residual_dark = int(
                temporal_dark_outlier_mask(
                    frames[index], originals[pair_index], originals[next_index]
                ).sum()
            )
            if args.hold_large_repair and residual_dark >= VISIBLE_DARK_REPAIR_MIN_PIXELS:
                # This fallback is deliberately opt-in and pair-local.  It is
                # used only after local reconstruction still fails the black
                # flash gate, never as a blanket interpolation substitute.
                frames[index] = originals[pair_index].copy()
                held_source_keys[pair_index] = True
            elif (
                args.hold_large_repair
                and repaired_large_magenta >= LARGE_RED_REPAIR_HOLD_PIXELS
            ):
                frames[index] = originals[pair_index].copy()
                held_source_keys[pair_index] = True

    args.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(compose(frames, args.out_cols), "RGBA").save(
        args.out, optimize=True, compress_level=9
    )
    write_previews(args.name, frames, args.frame_rate, args.mode, args.preview_dir)
    report = {
        "name": args.name,
        "sourceSheet": str(args.sheet),
        "outputSheet": str(args.out),
        "interpolation": "RIFE v4.6 RGB/alpha split with nearest-color bleed and optional temporal chroma repair",
        "pipelineVersion": PIPELINE_VERSION,
        "mode": args.mode,
        "loopStartSourceIndex": args.loop_start_index if args.mode == "loop" else None,
        "sourceFrameCount": len(originals),
        "outputFrameCount": len(frames),
        "frameWidth": args.frame_width,
        "frameHeight": args.frame_height,
        "cols": args.out_cols,
        "rows": math.ceil(len(frames) / args.out_cols),
        "sourceFrameRate": args.frame_rate,
        "outputFrameRate": args.frame_rate * 2,
        "durationPreserved": True,
        "middleFrameBottomAlignment": not args.preserve_vertical_motion,
        "middleFrameBlueSpillRepair": args.despill_blue_middle,
        "blueSpillThreshold": args.blue_spill_threshold if args.despill_blue_middle else None,
        "blueSpillPixelsRepaired": blue_spill_repairs,
        "keyFrameIndexMapping": "outputIndex = sourceIndex * 2",
        "middleFrameTimestep": 0.5,
        "directoryOutputCount": len(originals) * 2,
        "validation": validate(
            originals, frames, args.mode, shifts, dark_repairs,
            red_repairs, held_source_keys, args.repair_red_outliers,
            args.loop_start_index, args.despill_blue_middle,
            args.blue_spill_threshold,
        ),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
