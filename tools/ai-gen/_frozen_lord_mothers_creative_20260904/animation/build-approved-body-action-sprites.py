#!/usr/bin/env python3
"""Build formal sprite packages for approved snowfield-lord body actions."""

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
lower_body_anchor = COMMON["lower_body_anchor"]
get_model = COMMON["get_model"]

RIFE_TOOL = TOOLS / "rife-spritesheet-interpolate.py"
RIFE_EXE = (
    REPO.parent
    / "_tmp"
    / "elise_audit"
    / "rife"
    / "rife-ncnn-vulkan-20221029-windows"
    / "rife-ncnn-vulkan.exe"
)

SOURCE_VIDEO_FPS = 24
FRAME_HEIGHT = 256
FOOT_Y = 240
TARGET_BODY_HEIGHT = 224

ACTIONS = {
    "snow": {
        "asset": "snow-sepulcher-carrier",
        "displayName": "雪冢驮城兽",
        "action": "plow_prepare",
        "video": TASK_ROOT / "animation" / "videos" / "01-snow-sepulcher-carrier-plow-windup-h3-v02.mp4",
        "reference": TASK_ROOT / "animation" / "action-references" / "01-snow-sepulcher-carrier-plow-windup-v02-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "snow-sepulcher-carrier",
        "provider": "minimax-h3-local",
        "expectedSourceFrames": 124,
        "sourceFrames": list(range(8, 101, 2)),
        "excludedHead": [0, 7],
        "excludedTail": [101, 123],
        "probeFrames": [8, 24, 44, 68, 76, 96, 100],
        "facing": "screen-right low three-quarter",
        "topologyGate": "six weight-bearing legs and fused back tower remain readable",
        "phases": {
            "settle_into_brace": [0, 20],
            "brace": [21, 60],
            "fully_braced_hold": [61, 67],
            "recover": [68, 88],
            "settled": [89, 92],
        },
        "events": {
            "fullyBracedFrame": 60,
            "fullyBracedConsumerFrameIfOneBased": 61,
            "sourceFullyBracedFrame": 68,
        },
        "runtimeVfxContract": "body brace only; collider charge, snow plow trail and impact remain external and blocked",
        "blocked": ["plow_charge_and_impact", "collider_translation", "damage"],
    },
    "bell": {
        "asset": "white-silence-bell-hart",
        "displayName": "白寂鸣钟鹿",
        "action": "double_toll_body",
        "video": TASK_ROOT / "animation" / "videos" / "03-white-silence-bell-hart-double-toll-h3-v01.mp4",
        "reference": TASK_ROOT / "animation" / "action-references" / "03-white-silence-bell-hart-double-toll-prepare-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "white-silence-bell-hart",
        "provider": "minimax-h3-local",
        "expectedSourceFrames": 124,
        "sourceFrames": list(range(12, 85, 2)),
        "excludedHead": [0, 11],
        "excludedTail": [85, 123],
        "probeFrames": [12, 24, 36, 48, 62, 76, 84],
        "facing": "screen-right low three-quarter",
        "topologyGate": "four legs, antlers, one abdominal bell and exactly three pendants remain readable",
        "phases": {
            "backswing": [0, 12],
            "warning_toll": [13, 24],
            "return_swing": [25, 49],
            "damage_toll": [50, 56],
            "recover": [57, 72],
        },
        "events": {
            "warningRingFrame": 24,
            "warningRingConsumerFrameIfOneBased": 25,
            "sourceWarningRingFrame": 36,
            "damageRingFrame": 50,
            "damageRingConsumerFrameIfOneBased": 51,
            "sourceDamageRingFrame": 62,
            "warningToDamageMs": 1083,
            "futureThirdEchoOffsetMs": 750,
        },
        "runtimeVfxContract": "warning ring, delayed damage ring and optional third echo are external events; body sheet contains no ring VFX",
        "blocked": ["warning_ring_vfx", "damage_ring_vfx_and_damage", "third_echo", "runtime_state_machine"],
    },
    "aurora_oldstep": {
        "asset": "aurora-fate-weaver",
        "displayName": "极光织命母",
        "action": "oldstep_body",
        "video": TASK_ROOT / "animation" / "videos" / "02-aurora-fate-weaver-oldstep-body-doubao-v01.mp4",
        "reference": TASK_ROOT / "animation" / "action-references" / "02-aurora-fate-weaver-oldstep-prepare-v01-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "aurora-fate-weaver" / "oldstep-body",
        "provider": "doubao-desktop-seedance-2.0-mini",
        "expectedSourceFrames": 121,
        "sourceFrames": list(range(0, 85, 2)),
        "excludedHead": [],
        "excludedTail": [85, 120],
        "probeFrames": [0, 24, 40, 50, 62, 66, 84],
        "facing": "screen-right low three-quarter",
        "topologyGate": "six weight-bearing walking legs, two smaller weaving arms, open ring and contained aurora membrane remain stable",
        "phases": {
            "hold_prepare": [0, 12],
            "lower_arm_beat": [13, 30],
            "upper_arm_beat": [31, 56],
            "dual_arm_beat": [57, 68],
            "recover": [69, 84],
        },
        "events": {
            "oldestHistoryStrikeFrame": 24,
            "oldestHistoryStrikeConsumerFrameIfOneBased": 25,
            "middleHistoryStrikeFrame": 50,
            "middleHistoryStrikeConsumerFrameIfOneBased": 51,
            "newestHistoryStrikeFrame": 66,
            "newestHistoryStrikeConsumerFrameIfOneBased": 67,
            "sourceStrikeFrames": [24, 50, 66],
        },
        "runtimeVfxContract": "body gesture only; snapshot three historical positions on state entry and spawn all strike zones, telegraphs and damage externally",
        "blocked": ["oldstep_history_snapshot", "oldstep_strike_zones_and_damage", "runtime_state_machine"],
    },
    "aurora_tether": {
        "asset": "aurora-fate-weaver",
        "displayName": "极光织命母",
        "action": "tether_body",
        "video": TASK_ROOT / "animation" / "videos" / "02-aurora-fate-weaver-tether-body-doubao-v01.mp4",
        "reference": TASK_ROOT / "animation" / "action-references" / "02-aurora-fate-weaver-tether-prepare-v02-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "aurora-fate-weaver" / "tether-body",
        "provider": "doubao-desktop-seedance-2.0-mini",
        "expectedSourceFrames": 121,
        "sourceFrames": list(range(0, 105, 2)),
        "excludedHead": [],
        "excludedTail": [105, 120],
        "probeFrames": [0, 24, 32, 50, 54, 58, 78, 86, 104],
        "facing": "screen-right low three-quarter",
        "topologyGate": "six weight-bearing walking legs, two smaller weaving arms, open ring and contained aurora membrane remain stable through the self-occluding reel gesture",
        "phases": {
            "hold_prepare": [0, 12],
            "spread_and_lock": [13, 32],
            "tension_hold": [33, 50],
            "cross_and_reel": [51, 58],
            "hold_pull": [59, 78],
            "release": [79, 96],
            "recover": [97, 104],
        },
        "events": {
            "tetherLinesFrame": 32,
            "tetherLinesConsumerFrameIfOneBased": 33,
            "sourceTetherLinesFrame": 32,
            "tetherPullFrame": 58,
            "tetherPullConsumerFrameIfOneBased": 59,
            "sourceTetherPullFrame": 58,
            "lineToPullMs": 1083,
        },
        "runtimeVfxContract": "body gesture only; choose up to three distant targets and spawn visible tether lines externally at f32, then recheck LOS and apply the 140-unit pull externally at f58",
        "blocked": ["tether_target_selection_and_los", "tether_line_vfx", "tether_pull_displacement", "runtime_state_machine"],
    },
}


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


def save_contact(cells: list[np.ndarray], labels: list[str], path: Path, cols: int) -> None:
    thumb_w, thumb_h, label_h = 288, 192, 24
    rows = math.ceil(len(cells) / cols)
    contact = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for index, (cell, label) in enumerate(zip(cells, labels)):
        preview = checker(cell).resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = (index % cols) * thumb_w
        y = (index // cols) * (thumb_h + label_h)
        contact.paste(preview, (x, y))
        draw.text((x + 5, y + thumb_h + 3), label, fill="white")
    path.parent.mkdir(parents=True, exist_ok=True)
    contact.save(path)


def round32(value: int) -> int:
    return max(192, math.ceil(value / 32) * 32)


def choose_cols(frame_count: int, frame_width: int) -> int:
    max_cols = max(1, 4096 // frame_width)
    candidates = []
    for cols in range(5, max_cols + 1):
        cells = math.ceil(frame_count / cols) * cols
        empty_ratio = (cells - frame_count) / cells
        if empty_ratio <= 0.125:
            width = cols * frame_width
            height = math.ceil(frame_count / cols) * FRAME_HEIGHT
            if width > 4096 or height > 4096:
                continue
            candidates.append((cells, abs(width - height), max(width, height), cols))
    if not candidates:
        raise RuntimeError(f"no <=4096 layout for {frame_count} frames at width {frame_width}")
    return min(candidates)[-1]


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


def build_probe(keys: list[str]) -> None:
    model = get_model()
    for key in keys:
        spec = ACTIONS[key]
        frames, fps = decode(spec["video"])
        probe_dir = spec["outRoot"] / "probe-birefnet"
        probe_dir.mkdir(parents=True, exist_ok=True)
        cutouts = []
        stats = []
        for source_index in spec["probeFrames"]:
            rgba = cutout(frames[source_index], model)
            rgba[rgba[..., 3] == 0, :3] = 0
            cutouts.append(rgba)
            stats.append(frame_stats(source_index, rgba))
            Image.fromarray(rgba, "RGBA").save(probe_dir / f"source-f{source_index:03d}-birefnet.png")
            print(f"[{key}-probe] BiRefNet source f{source_index}", flush=True)
        save_contact(
            cutouts,
            [f"source f{index}" for index in spec["probeFrames"]],
            probe_dir / f"{spec['asset']}-{spec['action']}-birefnet-probe-contact.png",
            cols=7,
        )
        report = {
            "sourceVideo": str(spec["video"].relative_to(TASK_ROOT)).replace("\\", "/"),
            "decodedFrameCount": len(frames),
            "sourceVideoFps": fps,
            "probeFrames": spec["probeFrames"],
            "topologyGate": spec["topologyGate"],
            "cutout": "ComfyUI-RMBG BiRefNet-general via ai-asset pipeline module",
            "frames": stats,
        }
        (probe_dir / "probe-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )


def build_source_cells(frames: list[np.ndarray], selected: list[int], model) -> tuple[list[np.ndarray], int, float]:
    cutouts = {}
    for source_index in selected:
        cutouts[source_index] = cutout(frames[source_index], model)
        print(f"[approved-action] BiRefNet source f{source_index}", flush=True)

    reference = cutouts[selected[0]]
    _rx0, ry0, _rx1, ry1 = alpha_bbox(reference)
    base_scale = TARGET_BODY_HEIGHT / (ry1 - ry0 + 1)
    prepared = []
    required_half_width = 0.0
    for source_index in selected:
        rgba = cutouts[source_index]
        x0, y0, x1, y1 = alpha_bbox(rgba)
        crop = rgba[y0:y1 + 1, x0:x1 + 1]
        size = (
            max(1, round(crop.shape[1] * base_scale)),
            max(1, round(crop.shape[0] * base_scale)),
        )
        resized = np.asarray(Image.fromarray(crop, "RGBA").resize(size, Image.Resampling.LANCZOS))
        local_anchor = (lower_body_anchor(rgba) - x0) * base_scale
        required_half_width = max(required_half_width, local_anchor + 4, resized.shape[1] - local_anchor + 4)
        prepared.append((resized, local_anchor))

    frame_width = round32(math.ceil(required_half_width * 2 + 8))
    cells = []
    for resized, local_anchor in prepared:
        x = round(frame_width / 2 - local_anchor)
        y = FOOT_Y - resized.shape[0]
        cells.append(paste_checked(resized, x, y, frame_width, FRAME_HEIGHT))
    return cells, frame_width, base_scale


def validate(cells: list[np.ndarray]) -> dict:
    boxes = [alpha_bbox(cell) for cell in cells]
    return {
        "emptyFrames": [index for index, cell in enumerate(cells) if not np.any(cell[..., 3] > 8)],
        "touchingFrames": [
            index
            for index, (x0, y0, x1, y1) in enumerate(boxes)
            if x0 <= 2 or y0 <= 2 or x1 >= cells[index].shape[1] - 3 or y1 >= cells[index].shape[0] - 3
        ],
        "alphaBottomMin": min(box[3] for box in boxes),
        "alphaBottomMax": max(box[3] for box in boxes),
        "nonzeroRgbInTransparentPixels": max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        ),
    }


def build_action(key: str, model) -> None:
    spec = ACTIONS[key]
    out_root = spec["outRoot"]
    source_dir = out_root / "source-sheets-pre-rife"
    final_dir = out_root / "formal-final"
    preview_dir = out_root / "previews"
    report_dir = out_root / "reports"
    rife_work = preview_dir / "rife-tool"
    for directory in (source_dir, final_dir, preview_dir, report_dir, rife_work):
        directory.mkdir(parents=True, exist_ok=True)

    frames, fps = decode(spec["video"])
    if len(frames) != spec["expectedSourceFrames"] or abs(fps - SOURCE_VIDEO_FPS) > 0.01:
        raise RuntimeError(f"unexpected source video contract: frames={len(frames)} fps={fps}")
    selected = spec["sourceFrames"]
    duration_ms = round((selected[-1] - selected[0]) * 1000 / SOURCE_VIDEO_FPS)
    source_cells, frame_width, base_scale = build_source_cells(frames, selected, model)
    source_cols = choose_cols(len(source_cells), frame_width)
    source_sheet = source_dir / f"{spec['action'].replace('_', '-')}.png"
    Image.fromarray(compose(source_cells, source_cols), "RGBA").save(
        source_sheet, optimize=True, compress_level=9
    )
    source_contact = preview_dir / f"{spec['asset']}-{spec['action']}-source-contact.png"
    save_contact(
        source_cells,
        [f"key {index} / source f{source}" for index, source in enumerate(selected)],
        source_contact,
        cols=min(9, source_cols),
    )

    final_count = len(source_cells) * 2 - 1
    final_cols = choose_cols(final_count, frame_width)
    final_sheet = final_dir / f"{spec['action'].replace('_', '-')}.png"
    rife_report = report_dir / f"{spec['action'].replace('_', '-')}-rife.json"
    command = [
        sys.executable,
        str(RIFE_TOOL),
        "--sheet", str(source_sheet),
        "--out", str(final_sheet),
        "--name", f"{spec['asset']}-{spec['action']}",
        "--frame-width", str(frame_width),
        "--frame-height", str(FRAME_HEIGHT),
        "--cols", str(source_cols),
        "--frame-count", str(len(source_cells)),
        "--frame-rate", str(len(source_cells) * 1000 / duration_ms),
        "--mode", "one-shot",
        "--out-cols", str(final_cols),
        "--preview-dir", str(rife_work),
        "--report", str(rife_report),
        "--rife", str(RIFE_EXE),
        "--repair-magenta-middle",
        "--hold-large-repair",
    ]
    subprocess.run(command, check=True)
    rife_data = json.loads(rife_report.read_text(encoding="utf-8"))
    if int(rife_data["outputFrameCount"]) != final_count:
        raise RuntimeError(f"unexpected RIFE output count for {key}")
    final_cells = extract_cells(final_sheet, frame_width, FRAME_HEIGHT, final_count, final_cols)
    key_preserved = all(
        np.array_equal(source, final_cells[index * 2]) for index, source in enumerate(source_cells)
    )

    gif_timing = distributed_durations(final_count, duration_ms)
    gif_frames = [checker(cell) for cell in final_cells]
    preview_gif = preview_dir / f"{spec['asset']}-{spec['action']}.gif"
    gif_frames[0].save(
        preview_gif,
        save_all=True,
        append_images=gif_frames[1:],
        duration=gif_timing,
        loop=0,
        disposal=2,
        optimize=False,
    )
    final_contact = preview_dir / f"{spec['asset']}-{spec['action']}-contact.png"
    save_contact(
        final_cells,
        [f"f{index} {'key' if index % 2 == 0 else 'RIFE'}" for index in range(final_count)],
        final_contact,
        cols=min(9, final_cols),
    )

    validation = validate(final_cells)
    validation["originalKeyFramesPreservedAtEvenIndices"] = key_preserved
    if (
        validation["emptyFrames"]
        or validation["touchingFrames"]
        or validation["nonzeroRgbInTransparentPixels"]
        or not key_preserved
    ):
        raise RuntimeError(f"formal sprite validation failed for {key}: {validation}")
    with Image.open(final_sheet) as atlas:
        atlas_width, atlas_height = atlas.size
    if atlas_width > 4096 or atlas_height > 4096:
        raise RuntimeError(f"atlas exceeds 4096 for {key}: {atlas_width}x{atlas_height}")
    decoded_bytes = atlas_width * atlas_height * 4
    action_slug = spec["action"].replace("_", "-")
    manifest = {
        "asset": spec["asset"],
        "displayName": spec["displayName"],
        "action": spec["action"],
        "stage": "formal-sprite-asset-ready-not-runtime-integrated",
        "assetOnly": True,
        "runtimeIntegrationActive": False,
        "budgetTier": "boss",
        "facing": spec["facing"],
        "topologyGate": spec["topologyGate"],
        "rootMotion": "locked by lower-body anchor; no collider translation is baked into this sheet",
        "sourceVideo": str(spec["video"].relative_to(TASK_ROOT)).replace("\\", "/"),
        "sourceVideoProvider": spec["provider"],
        "sourceProvenance": str(spec["video"].relative_to(TASK_ROOT)).replace("\\", "/") + ".json",
        "sourceReference": str(spec["reference"].relative_to(TASK_ROOT)).replace("\\", "/"),
        "selectedSourceFrames": selected,
        "sourceWindow": [selected[0], selected[-1]],
        "sourceVideoFps": SOURCE_VIDEO_FPS,
        "sourceWallClockMs": duration_ms,
        "excludedHead": spec["excludedHead"],
        "excludedTail": spec["excludedTail"],
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
            "columns": final_cols,
            "rows": math.ceil(final_count / final_cols),
            "frameCount": final_count,
            "endFrame": final_count - 1,
            "footX": frame_width // 2,
            "footY": FOOT_Y,
            "targetBodyHeight": TARGET_BODY_HEIGHT,
            "baseScale": base_scale,
        },
        "clock": {
            "durationMs": duration_ms,
            "frameRate": final_count * 1000 / duration_ms,
            "repeat": 0,
            "frameIndices": "0-based",
            "phases": spec["phases"],
            "events": spec["events"],
            "runtimeVfxContract": spec["runtimeVfxContract"],
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
        "gifTimingMs": gif_timing,
        "validation": validation,
        "blockedRuntimeWork": spec["blocked"],
    }
    (out_root / "spritesheet-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    budget_manifest = {
        "version": 1,
        "id": f"{spec['asset']}-partial-{action_slug}-package",
        "profile": "boss",
        "assetOnly": True,
        "runtimeIntegrationActive": False,
        "scope": f"{spec['action']} only; full boss dependency closure is not complete",
        "sheets": [
            {
                "textureKey": f"enemy_{spec['asset'].replace('-', '_')}_{spec['action']}_candidate",
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
    (out_root / "sprite-budget-manifest.json").write_text(
        json.dumps(budget_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    readme = f"""# {spec['displayName']} `{spec['action']}` 正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `{spec['video'].relative_to(TASK_ROOT).as_posix()}`，24 FPS / 124 帧。
- 有效动作窗 `f{selected[0]}..f{selected[-1]}`，未插帧源键 {len(source_cells)} 张。
- 一次性非回绕 RIFE 2x 后 {final_count} 帧，原生键保留在偶数索引。
- 单格 `{frame_width}x{FRAME_HEIGHT}`，{final_cols} 列 x {math.ceil(final_count / final_cols)} 行，脚点 `({frame_width // 2},{FOOT_Y})`。
- 动作墙钟 {duration_ms}ms，所有事件帧为 0-based：`{json.dumps(spec['events'], ensure_ascii=False)}`。
- 当前单表解码 RGBA 约 {decoded_bytes / 1024 / 1024:.4f} MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：{', '.join(spec['blocked'])}。
"""
    (out_root / "README.md").write_text(readme, encoding="utf-8")
    print(f"[approved-action] built {key}: {frame_width}x{FRAME_HEIGHT} x {final_count}", flush=True)


def build_formal(keys: list[str]) -> None:
    if not RIFE_EXE.exists():
        raise SystemExit(f"missing RIFE executable: {RIFE_EXE}")
    model = get_model()
    for key in keys:
        build_action(key, model)


def parse_keys(value: str) -> list[str]:
    if value == "all":
        return list(ACTIONS)
    keys = [part.strip() for part in value.split(",") if part.strip()]
    unknown = [key for key in keys if key not in ACTIONS]
    if unknown:
        raise SystemExit(f"unknown action keys: {unknown}")
    return keys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--actions", default="all", help="snow,bell,aurora_oldstep,aurora_tether or all")
    parser.add_argument("--probe", action="store_true")
    args = parser.parse_args()
    keys = parse_keys(args.actions)
    if args.probe:
        build_probe(keys)
    else:
        build_formal(keys)


if __name__ == "__main__":
    main()
