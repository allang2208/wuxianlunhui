#!/usr/bin/env python3
"""Build the approved Aurora Fate Weaver body-cast sprite package.

The source is a one-shot H3 recover clip.  The formal action keeps source
frames f0..f80 at every second source frame, then runs exactly one non-wrapped
RIFE 2x pass so the original keys remain at even output indices.
"""

from __future__ import annotations

import argparse
import json
import math
import runpy
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


TASK_ROOT = Path(__file__).resolve().parents[1]
REPO = TASK_ROOT.parents[2]
TOOLS = TASK_ROOT.parent
COMMON = runpy.run_path(str(TOOLS / "character-run-video-rebuild.py"))
decode = COMMON["decode"]
cutout = COMMON["cutout"]
bbox = COMMON["bbox"]
lower_body_anchor = COMMON["lower_body_anchor"]
get_model = COMMON["get_model"]

VIDEO = TASK_ROOT / "animation" / "videos" / "02-aurora-fate-weaver-body-cast-h3-v02.mp4"
REFERENCE = TASK_ROOT / "animation" / "action-references" / "02-aurora-fate-weaver-body-cast-v02-1024x576.png"
OUT_ROOT = TASK_ROOT / "animation" / "formal" / "aurora-fate-weaver"
PROBE_DIR = OUT_ROOT / "probe-birefnet"
SOURCE_DIR = OUT_ROOT / "source-sheets-pre-rife"
FINAL_DIR = OUT_ROOT / "formal-final"
PREVIEW_DIR = OUT_ROOT / "previews"
REPORT_DIR = OUT_ROOT / "reports"

RIFE_TOOL = TOOLS / "rife-spritesheet-interpolate.py"
RIFE_EXE = (
    REPO.parent
    / "_tmp"
    / "elise_audit"
    / "rife"
    / "rife-ncnn-vulkan-20221029-windows"
    / "rife-ncnn-vulkan.exe"
)

SOURCE_FRAMES = list(range(0, 81, 2))
SOURCE_VIDEO_FPS = 24
SOURCE_DURATION_MS = round((SOURCE_FRAMES[-1] - SOURCE_FRAMES[0]) * 1000 / SOURCE_VIDEO_FPS)
PROBE_FRAMES = [0, 32, 40, 48, 56, 64, 80]

# Boss-scale asset frame.  Width is derived from the complete action after a
# single fixed scale; height and foot line stay shared across every key.
TARGET_BODY_HEIGHT = 224
FRAME_HEIGHT = 256
FOOT_Y = 240
FINAL_COLS = 9


def alpha_bbox(frame: np.ndarray, threshold: int = 8) -> tuple[int, int, int, int]:
    ys, xs = np.where(frame[..., 3] > threshold)
    if not len(xs):
        raise RuntimeError("empty alpha frame")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def paste_checked(content: np.ndarray, x: int, y: int, width: int, height: int) -> np.ndarray:
    ch, cw = content.shape[:2]
    if x < 3 or y < 3 or x + cw > width - 3 or y + ch > height - 3:
        raise RuntimeError(f"content clips: {cw}x{ch} at ({x},{y}) in {width}x{height}")
    frame = np.zeros((height, width, 4), dtype=np.uint8)
    frame[y:y + ch, x:x + cw] = content
    frame[frame[..., 3] == 0, :3] = 0
    return frame


def compose(cells: list[np.ndarray], cols: int) -> np.ndarray:
    height, width = cells[0].shape[:2]
    rows = math.ceil(len(cells) / cols)
    sheet = np.zeros((rows * height, cols * width, 4), dtype=np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[row * height:(row + 1) * height, col * width:(col + 1) * width] = cell
    return sheet


def extract_cells(path: Path, width: int, height: int, count: int, cols: int) -> list[np.ndarray]:
    sheet = np.asarray(Image.open(path).convert("RGBA"))
    return [
        sheet[(index // cols) * height:(index // cols + 1) * height,
              (index % cols) * width:(index % cols + 1) * width].copy()
        for index in range(count)
    ]


def checker(frame: np.ndarray) -> Image.Image:
    yy, xx = np.indices(frame.shape[:2])
    shade = np.where(((xx // 16 + yy // 16) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = frame[..., 3:4].astype(np.float32) / 255.0
    rgb = np.clip(frame[..., :3] * alpha + background * (1.0 - alpha), 0, 255)
    return Image.fromarray(rgb.astype(np.uint8), "RGB")


def distributed_durations(frame_count: int, total_ms: int) -> list[int]:
    preview_ms = round(total_ms / 10) * 10
    ticks = [round(index * preview_ms / frame_count / 10) for index in range(frame_count + 1)]
    values = [(ticks[index + 1] - ticks[index]) * 10 for index in range(frame_count)]
    if min(values) <= 0 or sum(values) != preview_ms:
        raise RuntimeError(f"invalid GIF timing: {values}")
    return values


def save_contact(cells: list[np.ndarray], labels: list[str], path: Path, cols: int = 7) -> None:
    thumb_w, thumb_h, label_h = 320, 180, 24
    rows = math.ceil(len(cells) / cols)
    contact = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for index, (cell, label) in enumerate(zip(cells, labels)):
        preview = checker(cell).resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = (index % cols) * thumb_w
        y = (index // cols) * (thumb_h + label_h)
        contact.paste(preview, (x, y))
        draw.text((x + 5, y + thumb_h + 4), label, fill="white")
    path.parent.mkdir(parents=True, exist_ok=True)
    contact.save(path)


def frame_stats(source_index: int, rgba: np.ndarray) -> dict:
    x0, y0, x1, y1 = alpha_bbox(rgba)
    alpha = rgba[..., 3]
    visible = alpha > 8
    semi = (alpha > 8) & (alpha < 247)
    return {
        "sourceFrame": source_index,
        "bbox": [x0, y0, x1, y1],
        "visiblePixels": int(visible.sum()),
        "semiTransparentPixels": int(semi.sum()),
        "semiTransparentRatio": round(float(semi.sum() / max(1, visible.sum())), 6),
    }


def build_probe() -> None:
    frames, fps = decode(VIDEO)
    model = get_model()
    PROBE_DIR.mkdir(parents=True, exist_ok=True)
    cutouts = []
    stats = []
    for source_index in PROBE_FRAMES:
        rgba = cutout(frames[source_index], model)
        rgba[rgba[..., 3] == 0, :3] = 0
        cutouts.append(rgba)
        stats.append(frame_stats(source_index, rgba))
        Image.fromarray(rgba, "RGBA").save(PROBE_DIR / f"source-f{source_index:03d}-birefnet.png")
        print(f"[aurora-probe] BiRefNet source f{source_index}", flush=True)
    save_contact(
        cutouts,
        [f"source f{index}" for index in PROBE_FRAMES],
        PROBE_DIR / "aurora-fate-weaver-birefnet-probe-contact.png",
    )
    report = {
        "sourceVideo": str(VIDEO.relative_to(TASK_ROOT)).replace("\\", "/"),
        "decodedFrameCount": len(frames),
        "sourceVideoFps": fps,
        "probeFrames": PROBE_FRAMES,
        "cutout": "ComfyUI-RMBG BiRefNet-general via ai-asset pipeline module",
        "frames": stats,
    }
    (PROBE_DIR / "probe-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def round32(value: int) -> int:
    return max(256, math.ceil(value / 32) * 32)


def build_source_cells(frames: list[np.ndarray], model) -> tuple[list[np.ndarray], int, float]:
    cutouts: dict[int, np.ndarray] = {}
    for source_index in SOURCE_FRAMES:
        cutouts[source_index] = cutout(frames[source_index], model)
        print(f"[aurora-formal] BiRefNet source f{source_index}", flush=True)

    reference = cutouts[SOURCE_FRAMES[0]]
    rx0, ry0, rx1, ry1 = alpha_bbox(reference)
    base_scale = TARGET_BODY_HEIGHT / (ry1 - ry0 + 1)
    prepared: list[tuple[np.ndarray, float]] = []
    required_half_width = 0.0
    for source_index in SOURCE_FRAMES:
        rgba = cutouts[source_index]
        x0, y0, x1, y1 = alpha_bbox(rgba)
        crop = rgba[y0:y1 + 1, x0:x1 + 1]
        size = (
            max(1, round(crop.shape[1] * base_scale)),
            max(1, round(crop.shape[0] * base_scale)),
        )
        resized = np.asarray(Image.fromarray(crop, "RGBA").resize(size, Image.Resampling.LANCZOS))
        local_anchor = (lower_body_anchor(rgba) - x0) * base_scale
        anchor_x = local_anchor
        required_half_width = max(required_half_width, anchor_x + 4, resized.shape[1] - anchor_x + 4)
        prepared.append((resized, local_anchor))

    frame_width = round32(math.ceil(required_half_width * 2 + 8))
    cells = []
    for resized, local_anchor in prepared:
        # Lock the planted lower-body root while preserving every limb's
        # motion inside the crop.  No per-frame fit or dynamic scaling.
        x = round(frame_width / 2 - local_anchor)
        y = FOOT_Y - resized.shape[0]
        cells.append(paste_checked(resized, x, y, frame_width, FRAME_HEIGHT))
    return cells, frame_width, base_scale


def validate(cells: list[np.ndarray]) -> dict:
    boxes = [alpha_bbox(cell) for cell in cells]
    empty = [index for index, cell in enumerate(cells) if not np.any(cell[..., 3] > 8)]
    touching = [
        index
        for index, (x0, y0, x1, y1) in enumerate(boxes)
        if x0 <= 2 or y0 <= 2 or x1 >= cells[index].shape[1] - 3 or y1 >= cells[index].shape[0] - 3
    ]
    return {
        "emptyFrames": empty,
        "touchingFrames": touching,
        "alphaBottomMin": min(box[3] for box in boxes),
        "alphaBottomMax": max(box[3] for box in boxes),
        "nonzeroRgbInTransparentPixels": max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        ),
    }


def build_formal() -> None:
    if not RIFE_EXE.exists():
        raise SystemExit(f"missing RIFE executable: {RIFE_EXE}")
    for directory in (SOURCE_DIR, FINAL_DIR, PREVIEW_DIR, REPORT_DIR):
        directory.mkdir(parents=True, exist_ok=True)

    frames, fps = decode(VIDEO)
    if len(frames) != 124 or abs(fps - SOURCE_VIDEO_FPS) > 0.01:
        raise RuntimeError(f"unexpected source video contract: frames={len(frames)} fps={fps}")
    model = get_model()
    source_cells, frame_width, base_scale = build_source_cells(frames, model)
    source_cols = 7
    source_sheet = SOURCE_DIR / "triangle-weave-body.png"
    Image.fromarray(compose(source_cells, source_cols), "RGBA").save(
        source_sheet, optimize=True, compress_level=9
    )
    source_contact = PREVIEW_DIR / "aurora-fate-weaver-triangle-weave-source-contact.png"
    save_contact(
        source_cells,
        [f"key {index} / source f{source}" for index, source in enumerate(SOURCE_FRAMES)],
        source_contact,
        cols=7,
    )

    final_sheet = FINAL_DIR / "triangle-weave-body.png"
    rife_report = REPORT_DIR / "triangle-weave-body-rife.json"
    rife_preview_dir = PREVIEW_DIR / "rife-tool"
    source_rate = len(source_cells) * 1000 / SOURCE_DURATION_MS
    command = [
        sys.executable,
        str(RIFE_TOOL),
        "--sheet",
        str(source_sheet),
        "--out",
        str(final_sheet),
        "--name",
        "aurora-fate-weaver-triangle-weave-body",
        "--frame-width",
        str(frame_width),
        "--frame-height",
        str(FRAME_HEIGHT),
        "--cols",
        str(source_cols),
        "--frame-count",
        str(len(source_cells)),
        "--frame-rate",
        str(source_rate),
        "--mode",
        "one-shot",
        "--out-cols",
        str(FINAL_COLS),
        "--preview-dir",
        str(rife_preview_dir),
        "--report",
        str(rife_report),
        "--rife",
        str(RIFE_EXE),
        "--repair-magenta-middle",
        "--hold-large-repair",
    ]
    subprocess.run(command, check=True)
    rife_data = json.loads(rife_report.read_text(encoding="utf-8"))
    final_count = int(rife_data["outputFrameCount"])
    final_cells = extract_cells(final_sheet, frame_width, FRAME_HEIGHT, final_count, FINAL_COLS)
    key_preserved = all(
        np.array_equal(source, final_cells[index * 2]) for index, source in enumerate(source_cells)
    )

    timing = distributed_durations(final_count, SOURCE_DURATION_MS)
    preview_frames = [checker(cell) for cell in final_cells]
    preview_gif = PREVIEW_DIR / "aurora-fate-weaver-triangle-weave-body.gif"
    preview_frames[0].save(
        preview_gif,
        save_all=True,
        append_images=preview_frames[1:],
        duration=timing,
        loop=0,
        disposal=2,
        optimize=False,
    )
    final_contact = PREVIEW_DIR / "aurora-fate-weaver-triangle-weave-body-contact.png"
    save_contact(
        final_cells,
        [f"f{index} {'key' if index % 2 == 0 else 'RIFE'}" for index in range(final_count)],
        final_contact,
        cols=9,
    )

    validation = validate(final_cells)
    validation["originalKeyFramesPreservedAtEvenIndices"] = key_preserved
    with Image.open(final_sheet) as atlas:
        atlas_width, atlas_height = atlas.size
    decoded_bytes = atlas_width * atlas_height * 4
    manifest = {
        "asset": "aurora-fate-weaver",
        "action": "triangle_weave_body",
        "stage": "formal-sprite-asset-ready-not-runtime-integrated",
        "assetOnly": True,
        "runtimeIntegrationActive": False,
        "budgetTier": "boss",
        "facing": "screen-right low three-quarter",
        "topologyGate": "six planted walking legs and two shorter raised weaving arms remain distinct; the open biological ring, contained membrane and screen-right body axis stay readable",
        "rootMotion": "legacy lower-body anchor registration; runtime does not translate the collider during this body cast",
        "sourceVideo": str(VIDEO.relative_to(TASK_ROOT)).replace("\\", "/"),
        "sourceVideoProvider": "minimax-h3-local",
        "sourceProvenance": str(VIDEO.relative_to(TASK_ROOT)).replace("\\", "/") + ".json",
        "sourceReference": str(REFERENCE.relative_to(TASK_ROOT)).replace("\\", "/"),
        "selectedSourceFrames": SOURCE_FRAMES,
        "sourceWindow": [0, 80],
        "sourceVideoFps": SOURCE_VIDEO_FPS,
        "sourceWallClockMs": SOURCE_DURATION_MS,
        "excludedTail": [81, 123],
        "excludedTailReason": "long recovered hold with negligible authored motion",
        "sourceSheet": str(source_sheet.relative_to(TASK_ROOT)).replace("\\", "/"),
        "finalSheet": str(final_sheet.relative_to(TASK_ROOT)).replace("\\", "/"),
        "previewGif": str(preview_gif.relative_to(TASK_ROOT)).replace("\\", "/"),
        "sourceContactSheet": str(source_contact.relative_to(TASK_ROOT)).replace("\\", "/"),
        "finalContactSheet": str(final_contact.relative_to(TASK_ROOT)).replace("\\", "/"),
        "rifeReport": str(rife_report.relative_to(TASK_ROOT)).replace("\\", "/"),
        "interpolation": {
            "passes": 1,
            "mode": "one-shot",
            "wrap": False,
            "sourceFrameCount": len(source_cells),
            "outputFrameCount": final_count,
            "keyFrameIndexMapping": "outputIndex = sourceKeyIndex * 2",
        },
        "layout": {
            "frameWidth": frame_width,
            "frameHeight": FRAME_HEIGHT,
            "columns": FINAL_COLS,
            "rows": math.ceil(final_count / FINAL_COLS),
            "frameCount": final_count,
            "endFrame": final_count - 1,
            "footX": frame_width // 2,
            "footY": FOOT_Y,
            "targetBodyHeight": TARGET_BODY_HEIGHT,
            "baseScale": base_scale,
        },
        "clock": {
            "durationMs": SOURCE_DURATION_MS,
            "frameRate": final_count * 1000 / SOURCE_DURATION_MS,
            "repeat": 0,
            "frameIndices": "0-based",
            "phases": {
                "gather": [0, 30],
                "extract": [31, 40],
                "released": [41, 54],
                "reweave": [55, 64],
                "recover": [65, 80],
            },
            "releaseFrame": 48,
            "releaseConsumerFrameIfOneBased": 49,
            "runtimeVfxContract": "spawn three target-locked weave points/lines externally; no external triangle is baked into the body sheet",
        },
        "atlas": {
            "width": atlas_width,
            "height": atlas_height,
            "decodedRgbaBytes": decoded_bytes,
            "decodedRgbaMiB": round(decoded_bytes / 1024 / 1024, 4),
            "pngBytes": final_sheet.stat().st_size,
            "bossTargetMiB": 128,
            "bossHardStopMiB": 256,
            "withinSingleAssetBossTarget": decoded_bytes <= 128 * 1024 * 1024,
        },
        "gifTimingMs": timing,
        "validation": validation,
        "userDecision": "mid-action membrane disappearance is intentional extract-release-reweave, approved 2026-09-05",
    }
    (OUT_ROOT / "spritesheet-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    budget_manifest = {
        "version": 1,
        "id": "aurora-fate-weaver-partial-body-cast-package",
        "profile": "boss",
        "assetOnly": True,
        "runtimeIntegrationActive": False,
        "scope": "triangle_weave_body only; full boss dependency closure is not complete",
        "sheets": [
            {
                "textureKey": "enemy_aurora_fate_weaver_triangle_weave_body_candidate",
                "path": str(final_sheet.relative_to(REPO)).replace("\\", "/"),
                "frameWidth": frame_width,
                "frameHeight": FRAME_HEIGHT,
                "frameCount": final_count,
                "endFrame": final_count - 1,
                "footX": frame_width // 2,
                "footY": FOOT_Y,
            }
        ],
        "dependencies": [],
    }
    (OUT_ROOT / "sprite-budget-manifest.json").write_text(
        json.dumps(budget_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", action="store_true", help="Build seven BiRefNet inspection frames only.")
    args = parser.parse_args()
    if args.probe:
        build_probe()
    else:
        build_formal()


if __name__ == "__main__":
    main()
