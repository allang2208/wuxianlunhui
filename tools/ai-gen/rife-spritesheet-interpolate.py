#!/usr/bin/env python3
"""RIFE v4.6 2x interpolation for one transparent character sprite sheet.

RGB and alpha are interpolated separately because rife-ncnn-vulkan does not
preserve alpha. Transparent RGB is filled from the nearest visible pixel before
RIFE to prevent dark edge halos. Original key-frame pixels remain unchanged at
even output indices after transparent-RGB normalization. Looping actions include
the last-to-first seam (N -> 2N); one-shot
actions never wrap (N -> 2N-1). Every generated middle frame is shifted by whole
pixels so its alpha bottom matches the mean of its two source neighbours.
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
PIPELINE_VERSION = "rife-v4.6-rgba-v2-temporal-dark-repair"
VISIBLE_DARK_ALPHA = 96
VISIBLE_DARK_MAX_RGB = 24
VISIBLE_DARK_DILATION = 12
VISIBLE_DARK_REPAIR_MIN_PIXELS = 8


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


def assemble_middle(
    first: np.ndarray, second: np.ndarray, middle_rgb: Path, middle_alpha: Path
) -> tuple[np.ndarray, int, int, bool]:
    rgb = np.asarray(Image.open(middle_rgb).convert("RGB")).copy()
    alpha = np.asarray(Image.open(middle_alpha).convert("L")).copy()
    alpha[alpha <= 2] = 0
    rgb[alpha == 0] = 0
    middle = np.dstack([rgb, alpha])

    current = alpha_bottom(middle)
    first_bottom = alpha_bottom(first)
    second_bottom = alpha_bottom(second)
    dy = 0
    if current is not None and first_bottom is not None and second_bottom is not None:
        target = round((first_bottom + second_bottom) / 2)
        dy = target - current
        middle = shift_vertical(middle, dy)
    middle, repaired_dark_pixels, held_source_key = repair_temporal_dark_outliers(
        middle, first, second
    )
    middle[middle[..., 3] == 0, :3] = 0
    return middle, dy, repaired_dark_pixels, held_source_key


def interpolate_pair(
    first: np.ndarray, second: np.ndarray, pair_dir: Path, rife: Path
) -> tuple[np.ndarray, int, int, bool]:
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
    return assemble_middle(first, second, middle_rgb, middle_alpha)


def interpolate(
    originals: list[np.ndarray], mode: str, work_dir: Path, rife: Path,
    loop_start_index: int = 0,
) -> tuple[list[np.ndarray], list[int], list[int], list[bool]]:
    pair_count = len(originals) if mode == "loop" else len(originals) - 1
    frames: list[np.ndarray] = []
    shifts: list[int] = []
    dark_repairs: list[int] = []
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
    sequence_count = len(originals) * 2 - 1
    run_rife_sequence(rife, rgb_input, rgb_output, sequence_count)
    run_rife_sequence(rife, alpha_input, alpha_output, sequence_count)

    for index in range(pair_count):
        next_index = index + 1
        if next_index >= len(originals):
            next_index = loop_start_index
        if index < len(originals) - 1:
            # Directory mode numbers outputs from 1. With 2N-1 outputs, even
            # filenames are the half-step frames between adjacent source keys.
            output_number = index * 2 + 2
            middle, dy, repaired_dark_pixels, held_source_key = assemble_middle(
                originals[index], originals[next_index],
                rgb_output / f"{output_number:08d}.png",
                alpha_output / f"{output_number:08d}.png",
            )
        else:
            middle, dy, repaired_dark_pixels, held_source_key = interpolate_pair(
                originals[index], originals[next_index],
                work_dir / f"pair-{index:03d}", rife,
            )
        frames.extend([originals[index], middle])
        shifts.append(dy)
        dark_repairs.append(repaired_dark_pixels)
        held_source_keys.append(held_source_key)
        print(
            f"[rife-sheet] pair {index + 1}/{pair_count} "
            f"source={index}->{next_index} foot_dy={dy} "
            f"dark_repaired={repaired_dark_pixels} "
            f"hold_fallback={held_source_key}",
            flush=True,
        )
    if mode == "one-shot":
        frames.append(originals[-1])
    return frames, shifts, dark_repairs, held_source_keys


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
    shifts: list[int], dark_repairs: list[int], held_source_keys: list[bool],
    loop_start_index: int,
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
    return {
        "emptyFrames": empty,
        "touchingFrames": touching,
        "alphaBottomMin": min(value for value in bottoms if value is not None),
        "alphaBottomMax": max(value for value in bottoms if value is not None),
        "middleFrameFootShifts": shifts,
        "middleFrameVisibleDarkPixelsRepaired": dark_repairs,
        "middleFrameHeldSourceKeyFallbacks": [
            index * 2 + 1 for index, held in enumerate(held_source_keys) if held
        ],
        "visibleDarkOutlierFrames": remaining_dark_outliers,
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
        frames, shifts, dark_repairs, held_source_keys = interpolate(
            originals, args.mode, Path(temp), args.rife, args.loop_start_index
        )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(compose(frames, args.out_cols), "RGBA").save(
        args.out, optimize=True, compress_level=9
    )
    write_previews(args.name, frames, args.frame_rate, args.mode, args.preview_dir)
    report = {
        "name": args.name,
        "sourceSheet": str(args.sheet),
        "outputSheet": str(args.out),
        "interpolation": "RIFE v4.6 RGB/alpha split with nearest-color bleed",
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
        "keyFrameIndexMapping": "outputIndex = sourceIndex * 2",
        "validation": validate(
            originals, frames, args.mode, shifts, dark_repairs,
            held_source_keys, args.loop_start_index,
        ),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
