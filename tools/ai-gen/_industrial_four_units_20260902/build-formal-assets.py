#!/usr/bin/env python3
"""Build formal four-unit sprite packages from reviewed MiniMax H3 videos.

The script intentionally refuses to process the draft frame selection. After
the 32-contact review, set formal-selection.json status to
``reviewed_after_h3_contacts`` and record the final source indices there.
Each action uses one fixed scale and source anchor, then receives exactly one
2x RIFE pass. Only idle/running wrap; death keeps its generated vertical motion.
"""

from __future__ import annotations

import importlib.util
import json
import math
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SELECTION_PATH = ROOT / "formal-selection.json"
PACKAGE_ROOT = ROOT / "formal-packages"
RIFE_TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
MAX_TEXTURE_SIDE = 4096
MAX_UNUSED_FRACTION = 0.125
BASE_SCRIPT = (
    REPO / "tools" / "ai-gen" / "_hamster_champion_plate_h3_20260901"
    / "build-runtime-source-sheets.py"
)
SPEC = importlib.util.spec_from_file_location("industrial_four_sprite_base", BASE_SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import sprite helpers: {BASE_SCRIPT}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)


def repo_path(value: str) -> Path:
    return REPO / Path(value)


def checker(frame: np.ndarray) -> Image.Image:
    yy, xx = np.indices(frame.shape[:2])
    shade = np.where(((xx // 20 + yy // 20) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = frame[..., 3:4].astype(np.float32) / 255.0
    rgb = frame[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def extract_cells(
    path: Path, frame_width: int, frame_height: int, frame_count: int, cols: int,
) -> list[np.ndarray]:
    sheet = np.asarray(Image.open(path).convert("RGBA"))
    frames = []
    for index in range(frame_count):
        row, col = divmod(index, cols)
        frames.append(
            sheet[
                row * frame_height:(row + 1) * frame_height,
                col * frame_width:(col + 1) * frame_width,
            ].copy()
        )
    return frames


def choose_cols(frame_count: int, frame_width: int, frame_height: int) -> int:
    """Choose the lowest-pixel legal layout; columns are intentionally not fixed."""
    candidates: list[tuple[int, float, float, int]] = []
    max_cols = max(1, MAX_TEXTURE_SIDE // frame_width)
    for cols in range(1, max_cols + 1):
        rows = math.ceil(frame_count / cols)
        if rows * frame_height > MAX_TEXTURE_SIDE:
            continue
        cells = rows * cols
        unused_fraction = (cells - frame_count) / cells
        if unused_fraction > MAX_UNUSED_FRACTION:
            continue
        width = cols * frame_width
        height = rows * frame_height
        aspect_penalty = abs(math.log(max(width, 1) / max(height, 1)))
        candidates.append((cells, unused_fraction, aspect_penalty, cols))
    if not candidates:
        raise RuntimeError(
            f"No <=4096px layout with <=12.5% unused cells for "
            f"{frame_count} frames of {frame_width}x{frame_height}"
        )
    return min(candidates)[3]


def gif_durations(frame_count: int, frame_rate: float) -> list[int]:
    """Distribute GIF 10 ms ticks without changing cumulative runtime duration."""
    durations: list[int] = []
    previous_tick = 0
    for frame_number in range(1, frame_count + 1):
        target_tick = int(math.floor(frame_number * 1000.0 / frame_rate / 10.0 + 0.5))
        target_tick = max(previous_tick + 2, target_tick)
        durations.append((target_tick - previous_tick) * 10)
        previous_tick = target_tick
    return durations


def save_contact(
    frames: list[np.ndarray], output: Path, source_indices: list[int] | None = None,
) -> None:
    tile_width = 192
    tile_height = max(1, round(frames[0].shape[0] * tile_width / frames[0].shape[1]))
    label_height = 22
    cols = 8
    rows = math.ceil(len(frames) / cols)
    contact = Image.new(
        "RGB", (cols * tile_width, rows * (tile_height + label_height)), "#20242a"
    )
    draw = ImageDraw.Draw(contact)
    for index, frame in enumerate(frames):
        row, col = divmod(index, cols)
        x, y = col * tile_width, row * (tile_height + label_height)
        contact.paste(
            checker(frame).resize((tile_width, tile_height), Image.Resampling.LANCZOS),
            (x, y),
        )
        suffix = f" / H3 f{source_indices[index]}" if source_indices else ""
        draw.text((x + 4, y + tile_height + 3), f"f{index}{suffix}", fill="white")
    contact.save(output, optimize=True)


def save_runtime_gif(
    frames: list[np.ndarray], output: Path, frame_rate: float, repeat: int,
) -> dict[str, object]:
    display_width = 512
    display_height = max(1, round(frames[0].shape[0] * display_width / frames[0].shape[1]))
    rendered = [
        checker(frame).resize((display_width, display_height), Image.Resampling.LANCZOS)
        for frame in frames
    ]
    playback = rendered if repeat == 0 else rendered * 3
    durations = gif_durations(len(playback), frame_rate)
    options: dict[str, object] = {
        "save_all": True,
        "append_images": playback[1:],
        "duration": durations,
        "disposal": 2,
        "optimize": False,
    }
    if repeat == -1:
        options["loop"] = 0
    playback[0].save(output, **options)
    return {
        "frameRate": frame_rate,
        "runtimeFrameCount": len(frames),
        "gifFrameCount": len(playback),
        "gifDurationMs": sum(durations),
        "gifFrameDurationMsRange": [min(durations), max(durations)],
        "loopMode": "infinite" if repeat == -1 else "once",
        "browserSafeMinimumFrameDurationMs": 20,
    }


def mapped_event_frame(source_indices: list[int], raw_frame: int) -> int:
    position = min(range(len(source_indices)), key=lambda item: abs(source_indices[item] - raw_frame))
    return position * 2 + 1  # Runtime config uses one-based frame numbers.


def fixed_layout(
    frames: list[np.ndarray], scale: float, cell_quantum: int = 32,
) -> tuple[int, int, float, float, int]:
    """Build the shared action layout without changing the authored transform.

    The champion helper historically rounds every cell to 32 pixels.  A 16px
    quantum is allowed for a single unusually wide cavalry action so transparent
    padding does not push the decoded-texture budget over the admission limit.
    This changes neither action scale nor anchor placement.
    """
    if cell_quantum not in (16, 32):
        raise RuntimeError(f"Unsupported cell quantum: {cell_quantum}")
    anchor_x = float(np.median([BASE.torso_anchor_x(frame) for frame in frames]))
    anchor_y = float(np.median([
        BASE.body_bbox(frame)[3] for frame in frames[:min(3, len(frames))]
    ]))
    left = right = top = bottom = 0.0
    for frame in frames:
        x0, y0, x1, y1 = BASE.alpha_bbox(frame)
        left = max(left, (anchor_x - x0) * scale)
        right = max(right, (x1 + 1 - anchor_x) * scale)
        top = max(top, (anchor_y - y0) * scale)
        bottom = max(bottom, (y1 + 1 - anchor_y) * scale)

    def quantized(value: float, minimum: int = 192) -> int:
        return max(minimum, int(math.ceil(value / cell_quantum) * cell_quantum))

    frame_width = quantized(max(left, right) * 2 + BASE.MARGIN * 2)
    frame_height = quantized(top + bottom + BASE.MARGIN * 2)
    foot_y = int(round(BASE.MARGIN + top))
    return frame_width, frame_height, anchor_x, anchor_y, foot_y


def predict_birefnet_cutout(rgb: np.ndarray, model) -> np.ndarray:
    """Return the semantic BiRefNet matte without restoring white-stage shadows.

    The previous builder took ``max(BiRefNet, colour distance from white)``.
    That reclassified pale floor/background shadows around boots and paws as
    foreground.  It also made a later fixed-rectangle tail deletion look like
    an alpha cleanup even though the rectangle crossed real coat/leg pixels.
    This rebuild keeps BiRefNet as the authority and never erases a semantic
    body region by coordinates.
    """
    alpha = np.asarray(BASE.HELPER.predict_alpha(model, Image.fromarray(rgb, "RGB")))
    alpha = np.squeeze(alpha)
    if alpha.shape != rgb.shape[:2]:
        alpha = cv2.resize(alpha, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR)
    if alpha.max(initial=0) <= 1.5:
        alpha = alpha * 255.0
    alpha = BASE.keep_near_subject(np.clip(alpha, 0, 255).astype(np.uint8))
    alpha[alpha < 4] = 0

    bg = BASE.detected_background(rgb)
    a = alpha.astype(np.float32) / 255.0
    foreground = (
        rgb.astype(np.float32) - (1.0 - a[..., None]) * bg
    ) / np.maximum(a[..., None], 1e-3)
    foreground = np.clip(foreground, 0, 255).astype(np.uint8)
    foreground[alpha == 0] = 0
    return np.dstack((foreground, alpha))


def background_connected_light_mask(rgb: np.ndarray) -> np.ndarray:
    """Find only neutral light pixels connected to the source-video border."""
    bg = BASE.detected_background(rgb)
    work = rgb.astype(np.float32)
    distance = np.linalg.norm(work - bg, axis=2)
    spread = work.max(axis=2) - work.min(axis=2)
    luminance = work.mean(axis=2)
    candidate = ((distance < 78.0) & (spread < 30.0) & (luminance > 172.0)).astype(np.uint8)
    candidate = cv2.morphologyEx(
        candidate, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    )
    count, labels = cv2.connectedComponents(candidate, 8)
    if count <= 1:
        return np.zeros(rgb.shape[:2], dtype=bool)
    border_labels = np.unique(np.concatenate((
        labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]
    )))
    border_labels = border_labels[border_labels != 0]
    return np.isin(labels, border_labels)


def clean_white_stage_residue(rgb: np.ndarray, rgba: np.ndarray) -> tuple[np.ndarray, dict[str, int]]:
    """Remove low-confidence white-stage matte connected to the video exterior.

    High-confidence semantic foreground is protected so white muzzle fur, pale
    paws and silver armour are not keyed out merely for being light coloured.
    """
    result = rgba.copy()
    alpha = result[..., 3]
    exterior = background_connected_light_mask(rgb)
    low_confidence = alpha < 224
    removed = exterior & (alpha > 0) & low_confidence
    result[removed, 3] = 0

    # Feather the one-pixel matte band instead of leaving a white outline.
    exterior_near = cv2.dilate(exterior.astype(np.uint8), np.ones((3, 3), np.uint8), 1).astype(bool)
    edge = exterior_near & (result[..., 3] > 0) & (result[..., 3] < 248)
    if edge.any():
        bg = BASE.detected_background(rgb)
        contrast = np.linalg.norm(rgb.astype(np.float32) - bg, axis=2)
        cap = np.clip((contrast - 10.0) / 52.0 * 255.0, 0, 255).astype(np.uint8)
        result[..., 3][edge] = np.minimum(result[..., 3][edge], cap[edge])
    result[result[..., 3] < 4] = 0
    result[result[..., 3] == 0, :3] = 0
    return result, {
        "removedLowConfidenceLightPixels": int(np.count_nonzero(removed)),
        "featheredLightEdgePixels": int(np.count_nonzero(edge)),
    }


def main() -> None:
    selection = json.loads(SELECTION_PATH.read_text(encoding="utf-8"))
    allowed_statuses = {
        "ready_for_rebuild_after_user_visual_rejection",
        "ready_for_heavy_charge_v02_rebuild",
    }
    if selection.get("status") not in allowed_statuses:
        raise RuntimeError(
            "formal-selection.json is not ready for the user-rejected animation rebuild; "
            "refusing to process draft frame indices"
        )

    model = None
    combined: dict[str, object] = {
        "schemaVersion": 1,
        "date": "2026-09-02",
        "source": "reviewed MiniMax H3 videos",
        "fixedTransformWithinEachAction": True,
        "interpolation": "one 2x RIFE pass per action",
        "loopPolicy": "idle/running only",
        "budgetTargetMiB": 32,
        "budgetAdmissionMiB": 64,
        "units": {},
    }

    for unit_key, unit in selection["units"].items():
        unit_root = repo_path(unit["unitRoot"])
        runtime_root = repo_path(unit["runtimeAssetRoot"])
        package = PACKAGE_ROOT / unit_key
        cutout_root = package / "cutouts"
        source_root = package / "source-sheets-pre-rife"
        preview_root = package / "previews"
        report_root = package / "reports"
        for directory in (runtime_root, cutout_root, source_root, preview_root, report_root):
            directory.mkdir(parents=True, exist_ok=True)

        unit_report: dict[str, object] = {
            "unitKey": unit_key,
            "targetEffectiveBodyHeight": unit["targetBodyHeight"],
            "desiredWorldBodyHeight": unit["desiredWorldBodyHeight"],
            "runtimeAssetRoot": unit["runtimeAssetRoot"],
            "actions": {},
        }
        total_decoded = 0

        for action_name, action in unit["actions"].items():
            video = (
                repo_path(action["sourceVideo"])
                if action.get("sourceVideo")
                else unit_root / "videos" / f"{action_name}-h3-v01.mp4"
            )
            decoded, source_fps = BASE.HELPER.decode_video(video)
            indices = [int(value) for value in action["indices"]]
            if min(indices) < 0 or max(indices) >= len(decoded):
                raise RuntimeError(
                    f"{unit_key}/{action_name} indices {min(indices)}..{max(indices)} "
                    f"outside decoded video 0..{len(decoded) - 1}"
                )

            action_cutouts = cutout_root / str(action.get("cacheKey", action_name))
            action_cutouts.mkdir(parents=True, exist_ok=True)
            rgba_frames: list[np.ndarray] = []
            alpha_cleanup_by_source_frame: dict[int, dict[str, int]] = {}
            for source_index in indices:
                cache = action_cutouts / f"f{source_index:03d}.png"
                pristine_cache = action_cutouts / f"f{source_index:03d}-birefnet.png"
                if pristine_cache.exists():
                    pristine = np.asarray(Image.open(pristine_cache).convert("RGBA"))
                    print(f"[industrial-four] pristine cached {unit_key}/{action_name} f{source_index}", flush=True)
                else:
                    if model is None:
                        model = BASE.HELPER.get_model()
                    pristine = predict_birefnet_cutout(decoded[source_index], model)
                    Image.fromarray(pristine, "RGBA").save(
                        pristine_cache, optimize=True, compress_level=9
                    )
                    print(f"[industrial-four] BiRefNet semantic {unit_key}/{action_name} f{source_index}", flush=True)
                rgba, alpha_cleanup = clean_white_stage_residue(
                    decoded[source_index], pristine
                )
                alpha_cleanup_by_source_frame[source_index] = alpha_cleanup
                obsolete_cleanup = action_cutouts / f"f{source_index:03d}-cleanup.json"
                if obsolete_cleanup.exists():
                    obsolete_cleanup.unlink()
                Image.fromarray(rgba, "RGBA").save(cache, optimize=True, compress_level=9)
                rgba_frames.append(rgba)

            loop_endpoint_index = action.get("loopEndpointRawFrame")
            use_endpoint_for_rife = bool(action.get("useLoopEndpointForRife", False))
            rife_rgba_frames = list(rgba_frames)
            rife_source_indices = list(indices)
            if loop_endpoint_index is not None and use_endpoint_for_rife:
                endpoint_index = int(loop_endpoint_index)
                if endpoint_index < 0 or endpoint_index >= len(decoded):
                    raise RuntimeError(
                        f"{unit_key}/{action_name} endpoint {endpoint_index} outside "
                        f"decoded video 0..{len(decoded) - 1}"
                    )
                endpoint_pristine_cache = action_cutouts / f"f{endpoint_index:03d}-birefnet.png"
                endpoint_cache = action_cutouts / f"f{endpoint_index:03d}.png"
                if endpoint_pristine_cache.exists():
                    endpoint_pristine = np.asarray(
                        Image.open(endpoint_pristine_cache).convert("RGBA")
                    )
                else:
                    if model is None:
                        model = BASE.HELPER.get_model()
                    endpoint_pristine = predict_birefnet_cutout(decoded[endpoint_index], model)
                    Image.fromarray(endpoint_pristine, "RGBA").save(
                        endpoint_pristine_cache, optimize=True, compress_level=9
                    )
                endpoint_rgba, endpoint_cleanup = clean_white_stage_residue(
                    decoded[endpoint_index], endpoint_pristine
                )
                Image.fromarray(endpoint_rgba, "RGBA").save(
                    endpoint_cache, optimize=True, compress_level=9
                )
                alpha_cleanup_by_source_frame[endpoint_index] = endpoint_cleanup
                rife_rgba_frames.append(endpoint_rgba)
                rife_source_indices.append(endpoint_index)

            calibration_key_count = int(
                action.get("calibrationKeyCount", 2 if action_name == "dying" else 4)
            )
            upright_heights = []
            for frame in rgba_frames[: min(calibration_key_count, len(rgba_frames))]:
                _, y0, _, y1 = BASE.body_bbox(frame)
                upright_heights.append(y1 - y0 + 1)
            median_height = float(np.median(upright_heights))
            fixed_scale = float(unit["targetBodyHeight"]) / median_height
            cell_quantum = int(action.get("cellQuantum", 32))
            frame_width, frame_height, anchor_x, anchor_y, foot_y = fixed_layout(
                rife_rgba_frames, fixed_scale, cell_quantum
            )
            if frame_width > 1024 or frame_height > 512:
                raise RuntimeError(
                    f"{unit_key}/{action_name} needs unsupported cell "
                    f"{frame_width}x{frame_height}"
                )
            cells = [
                BASE.place_fixed(
                    frame, fixed_scale, frame_width, frame_height,
                    anchor_x, anchor_y, foot_y,
                )
                for frame in rife_rgba_frames
            ]
            source_cols = choose_cols(len(cells), frame_width, frame_height)
            source_sheet = source_root / f"{action_name}.png"
            Image.fromarray(BASE.compose(cells, source_cols), "RGBA").save(
                source_sheet, optimize=True, compress_level=9
            )
            save_contact(
                cells, preview_root / f"{action_name}-source-contact.png", rife_source_indices
            )

            is_runtime_loop = int(action["repeat"]) == -1
            # Explicit source endpoints are retained as audit evidence. Use one as
            # the RIFE target only when the reviewed endpoint is a clean repeated
            # phase; otherwise direct wrap repair targets the opening key.
            mode = (
                "one-shot" if use_endpoint_for_rife
                else ("loop" if is_runtime_loop else "one-shot")
            )
            runtime_fps = float(action["runtimeFps"])
            source_sheet_fps = runtime_fps / 2.0
            final_count = len(rgba_frames) * 2 if is_runtime_loop else len(rgba_frames) * 2 - 1
            rife_final_count = len(cells) * 2 if mode == "loop" else len(cells) * 2 - 1
            final_cols = choose_cols(final_count, frame_width, frame_height)
            rife_cols = choose_cols(rife_final_count, frame_width, frame_height)
            staged = runtime_root / f".{action_name}.next.png"
            final_sheet = runtime_root / f"{action_name}.png"
            rife_report = report_root / f"{action_name}-rife.json"
            command = [
                sys.executable, str(RIFE_TOOL),
                "--sheet", str(source_sheet),
                "--out", str(staged),
                "--name", f"{unit_key}-{action_name}",
                "--frame-width", str(frame_width),
                "--frame-height", str(frame_height),
                "--cols", str(source_cols),
                "--frame-count", str(len(cells)),
                "--frame-rate", str(source_sheet_fps),
                "--mode", mode,
                "--out-cols", str(rife_cols),
                "--preview-dir", str(preview_root),
                "--report", str(rife_report),
                "--repair-magenta-middle",
                "--repair-red-outliers",
            ]
            if action.get("preserveVerticalMotion"):
                command.append("--preserve-vertical-motion")
            subprocess.run(command, cwd=REPO, check=True)
            generated_cells = extract_cells(
                staged, frame_width, frame_height, rife_final_count, rife_cols
            )
            if use_endpoint_for_rife:
                if rife_final_count != final_count + 1:
                    raise RuntimeError(
                        f"{unit_key}/{action_name} endpoint exclusion count mismatch"
                    )
                final_cells = generated_cells[:-1]
            else:
                final_cells = generated_cells
            staged.unlink()
            raw_middle_replacements: dict[str, int] = {}
            for output_index_text, source_index_value in action.get(
                "replaceRifeMiddleWithRaw", {}
            ).items():
                output_index = int(output_index_text)
                source_index = int(source_index_value)
                if output_index <= 0 or output_index >= final_count - 1:
                    raise RuntimeError(
                        f"{unit_key}/{action_name} invalid middle output index {output_index}"
                    )
                pristine_cache = action_cutouts / f"f{source_index:03d}-birefnet.png"
                cache = action_cutouts / f"f{source_index:03d}.png"
                if pristine_cache.exists():
                    pristine = np.asarray(Image.open(pristine_cache).convert("RGBA"))
                else:
                    if model is None:
                        model = BASE.HELPER.get_model()
                    pristine = predict_birefnet_cutout(decoded[source_index], model)
                    Image.fromarray(pristine, "RGBA").save(
                        pristine_cache, optimize=True, compress_level=9
                    )
                rgba, replacement_cleanup = clean_white_stage_residue(
                    decoded[source_index], pristine
                )
                Image.fromarray(rgba, "RGBA").save(cache, optimize=True, compress_level=9)
                alpha_cleanup_by_source_frame[source_index] = replacement_cleanup
                final_cells[output_index] = BASE.place_fixed(
                    rgba, fixed_scale, frame_width, frame_height,
                    anchor_x, anchor_y, foot_y,
                )
                raw_middle_replacements[str(output_index)] = source_index
            Image.fromarray(BASE.compose(final_cells, final_cols), "RGBA").save(
                final_sheet, optimize=True, compress_level=9
            )
            runtime_contact = preview_root / f"{action_name}-runtime-contact.png"
            runtime_gif = preview_root / f"{action_name}.gif"
            save_contact(final_cells, runtime_contact)
            preview_report = save_runtime_gif(
                final_cells, runtime_gif, runtime_fps, int(action["repeat"])
            )
            validation = BASE.HELPER.validate_cells(final_cells, int(action["repeat"]))
            validation["nonzeroRgbInTransparentPixels"] = max(
                int(np.count_nonzero(frame[..., :3][frame[..., 3] == 0]))
                for frame in final_cells
            )
            rows = math.ceil(final_count / final_cols)
            active_frame_bytes = final_count * frame_width * frame_height * 4
            decoded_bytes = rows * final_cols * frame_width * frame_height * 4
            total_decoded += decoded_bytes
            action_report: dict[str, object] = {
                "configKey": action["configKey"],
                "sourceVideo": str(video.relative_to(REPO)).replace("\\", "/"),
                "sourceVideoFrameCount": len(decoded),
                "sourceVideoFrameRate": source_fps,
                "sourceIndices": indices,
                "sourceFrameCount": len(rgba_frames),
                "rifeInputFrameCount": len(cells),
                "rifeOutputFrameCountBeforeEndpointExclusion": rife_final_count,
                "finalFrameCount": final_count,
                "frameWidth": frame_width,
                "frameHeight": frame_height,
                "cols": final_cols,
                "rows": rows,
                "frameRate": runtime_fps,
                "repeat": int(action["repeat"]),
                "cellQuantum": cell_quantum,
                "footY": foot_y,
                "fixedSourceAnchor": {"x": anchor_x, "y": anchor_y},
                "fixedActionScale": fixed_scale,
                "sourceMedianUprightBodyHeight": median_height,
                "scaleCalibrationKeyCount": calibration_key_count,
                "activeFrameBytes": active_frame_bytes,
                "activeFrameMiB": active_frame_bytes / (1024 ** 2),
                "decodedBytes": decoded_bytes,
                "decodedMiB": decoded_bytes / (1024 ** 2),
                "budgetBasis": "full decoded texture including padded cells",
                "unusedCellFraction": (rows * final_cols - final_count) / (rows * final_cols),
                "maxTextureSide": MAX_TEXTURE_SIDE,
                "runtimeSheet": str(final_sheet.relative_to(REPO)).replace("\\", "/"),
                "runtimeGif": str(runtime_gif.relative_to(REPO)).replace("\\", "/"),
                "runtimeContact": str(runtime_contact.relative_to(REPO)).replace("\\", "/"),
                "preview": preview_report,
                "validation": validation,
                "alphaCleanup": {
                    "method": "BiRefNet semantic matte plus border-connected low-confidence light-stage removal",
                    "fixedCoordinateEraseUsed": False,
                    "bySourceFrame": alpha_cleanup_by_source_frame,
                },
            }
            if raw_middle_replacements:
                action_report["rawMiddleFrameReplacements"] = raw_middle_replacements
                action_report["rawMiddleFrameReplacementReason"] = (
                    "Replace a visibly deformed RIFE middle with the exact intervening "
                    "MiniMax H3 source frame, using the same action scale and anchor."
                )
            if action.get("loopEndpointRawFrame") is not None:
                action_report["loopEndpointRawFrame"] = int(action["loopEndpointRawFrame"])
                action_report["loopEndpointUsedAsRifeInput"] = use_endpoint_for_rife
                action_report["loopRepairTargetRawFrame"] = (
                    int(action["loopEndpointRawFrame"])
                    if use_endpoint_for_rife else int(indices[0])
                )
                action_report["loopIntervalContract"] = (
                    "contiguous [start, reviewed endpoint); the matching endpoint is "
                    "appended only as the one-shot RIFE target and excluded from the "
                    "runtime cycle"
                    if use_endpoint_for_rife else
                    "contiguous [start, reviewed endpoint); one 2x wrap RIFE pass "
                    "targets the opening frame because the generated endpoint drifted"
                )
            if action.get("releaseRawFrames"):
                action_report["releaseFrames"] = [
                    mapped_event_frame(indices, int(raw)) for raw in action["releaseRawFrames"]
                ]
            if action.get("impactRawFrame") is not None:
                action_report["impactFrame"] = mapped_event_frame(
                    indices, int(action["impactRawFrame"])
                )
            if action.get("hitEndRawFrame") is not None:
                action_report["hitEndFrame"] = mapped_event_frame(
                    indices, int(action["hitEndRawFrame"])
                )
            unit_report["actions"][action_name] = action_report

        unit_report["totalDecodedBytes"] = total_decoded
        unit_report["totalDecodedMiB"] = total_decoded / (1024 ** 2)
        unit_report["withinTargetBudget"] = total_decoded <= 32 * 1024 ** 2
        unit_report["withinAdmissionBudget"] = total_decoded <= 64 * 1024 ** 2
        if not unit_report["withinAdmissionBudget"]:
            raise RuntimeError(
                f"{unit_key} decoded sprite budget "
                f"{unit_report['totalDecodedMiB']:.2f} MiB exceeds 64 MiB"
            )
        runtime_id = Path(unit["runtimeAssetRoot"]).name
        budget_manifest = {
            "version": 1,
            "id": runtime_id,
            "profile": "crowd",
            "sheets": [
                {
                    "textureKey": f"companion_{runtime_id}_{action['configKey']}",
                    "path": action["runtimeSheet"],
                    "frameWidth": action["frameWidth"],
                    "frameHeight": action["frameHeight"],
                    "frameCount": action["finalFrameCount"],
                    "endFrame": action["finalFrameCount"] - 1,
                    "footX": action["frameWidth"] // 2,
                    "footY": action["footY"],
                }
                for action in unit_report["actions"].values()
            ],
            "dependencies": [],
        }
        budget_manifest_path = package / "sprite-budget-manifest.json"
        budget_manifest_path.write_text(
            json.dumps(budget_manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        unit_report["spriteBudgetManifest"] = str(
            budget_manifest_path.relative_to(REPO)
        ).replace("\\", "/")
        (package / "formal-package-report.json").write_text(
            json.dumps(unit_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        combined["units"][unit_key] = unit_report

    (ROOT / "formal-build-report.json").write_text(
        json.dumps(combined, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(combined, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
