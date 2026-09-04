#!/usr/bin/env python3
"""Build the five approved reed-shadow sickle mantis runtime sprite sheets.

Pipeline: approved H3 video -> BiRefNet white-background cutout -> fixed rear-body
scale/root layout -> RIFE v4.6 RGBA 2x -> runtime assets. Thin legs, antennae and
raptorial sickles are excluded from scale measurement but retained in each cell.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import argparse
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parent
REPO = TOOLS.parents[1]
sys.path.insert(0, str(TOOLS))
from rmbg_cutout import get_model, predict_alpha  # noqa: E402


VIDEO_DIR = ROOT / "videos"
FRAME_DIR = ROOT / "frames"
SOURCE_DIR = ROOT / "spritesheets" / "source-pre-rife"
FINAL_DIR = ROOT / "spritesheets" / "final"
REPORT_SOURCE_DIR = ROOT / "reports" / "sprites" / "source-pre-rife"
REPORT_FINAL_DIR = ROOT / "reports" / "sprites" / "final"
PREVIEW_DIR = ROOT / "previews" / "sprites" / "final"
RUNTIME_DIR = REPO / "assets" / "enemies" / "reed_shadow_sickle_mantis"
RIFE_TOOL = TOOLS / "rife-spritesheet-interpolate.py"
RIFE_EXE = (
    REPO.parent
    / "_tmp"
    / "elise_audit"
    / "rife"
    / "rife-ncnn-vulkan-20221029-windows"
    / "rife-ncnn-vulkan.exe"
)

CELL_HEIGHT = 640
FOOT_Y = 560
REFERENCE_CELL = 640
TARGET_REAR_BODY_WIDTH = 260.0
EDGE_PAD = 24
ALPHA_BBOX_THRESHOLD = 10
SUPPORTED_WIDTHS = (640, 768, 896, 1024, 1152, 1280, 1536)

ACTIONS = {
    "idle": {
        "video": VIDEO_DIR / "idle-h3-v01.mp4",
        "frames": list(range(0, 120, 8)),
        "mode": "loop",
        "sourceFrameRate": 6.0,
        "sourceCols": 8,
        "anchor": "stabilized",
        "runtime": "idle.png",
    },
    "walking": {
        "video": VIDEO_DIR / "moving-h3-v01.mp4",
        "frames": list(range(0, 120, 6)),
        "mode": "loop",
        "sourceFrameRate": 8.0,
        "sourceCols": 8,
        "anchor": "stabilized",
        "runtime": "walking.png",
    },
    "attacking": {
        "video": VIDEO_DIR / "attacking-h3-v01.mp4",
        "frames": [15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 48, 54, 60, 66, 72, 78, 84, 90],
        "mode": "one-shot",
        "sourceFrameRate": 12.0,
        "sourceCols": 8,
        "anchor": "source-motion",
        "runtime": "attacking.png",
        "contactSourceFrame": 30,
    },
    "fan_sweep": {
        "video": VIDEO_DIR / "attacking-fan-sweep-h3-v04.mp4",
        "frames": [0, 4, 8, 10, 12, 14, 16, 18, 20, 21, 22, 24, 26, 28, 30, 32, 34, 36, 40],
        "mode": "one-shot",
        "sourceFrameRate": 12.0,
        "sourceCols": 8,
        "anchor": "source-motion",
        "runtime": "fan_sweep.png",
        "contactSourceFrame": 22,
        "suppressPaleMotionArtifacts": True,
    },
    "dying": {
        "video": VIDEO_DIR / "dying-h3-v01.mp4",
        "frames": [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 72, 96, 123],
        "mode": "one-shot",
        "sourceFrameRate": 8.0,
        "sourceCols": 8,
        "anchor": "source-motion-grounded",
        "runtime": "dying.png",
    },
}


def decode(path: Path) -> list[Image.Image]:
    with av.open(str(path)) as container:
        return [
            Image.fromarray(frame.to_ndarray(format="rgb24"), "RGB")
            for frame in container.decode(video=0)
        ]


def bbox(alpha: np.ndarray, threshold: int = ALPHA_BBOX_THRESHOLD) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > threshold)
    if not len(xs):
        raise ValueError("empty alpha mask")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def remove_tiny_components(alpha: np.ndarray, min_pixels: int = 10) -> np.ndarray:
    visible = alpha > 8
    count, labels = cv2.connectedComponents(visible.astype(np.uint8))
    if count <= 1:
        raise ValueError("empty BiRefNet result")
    keep = np.zeros_like(visible)
    for label in range(1, count):
        component = labels == label
        if int(component.sum()) >= min_pixels:
            keep |= component
    result = alpha.copy()
    result[~keep] = 0
    return result


def white_distance_alpha(rgb: np.ndarray) -> np.ndarray:
    distance = np.linalg.norm(rgb.astype(np.float32) - 255.0, axis=2)
    # H3 uses flat white; this preserves thin dark antennae/legs that semantic
    # removal can under-estimate while keeping near-white compression noise out.
    return np.clip((distance - 5.0) * (255.0 / 24.0), 0, 255).astype(np.uint8)


def white_decontaminate(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    a = alpha.astype(np.float32)[..., None] / 255.0
    foreground = (rgb.astype(np.float32) - 255.0 * (1.0 - a)) / np.maximum(a, 0.04)
    foreground = np.clip(foreground, 0, 255).astype(np.uint8)
    foreground[alpha == 0] = 0
    return foreground


def cutout(
    model,
    image: Image.Image,
    suppress_pale_motion_artifacts: bool = False,
) -> tuple[np.ndarray, np.ndarray, dict]:
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    semantic = np.asarray(predict_alpha(model, image.convert("RGB")), dtype=np.uint8)
    alpha = np.maximum(semantic, white_distance_alpha(rgb))
    alpha = remove_tiny_components(alpha)

    # The approved fan-sweep source contains broad, low-saturation white/grey
    # motion-smear crescents. BiRefNet and the white-distance fallback both see
    # them as foreground, which bakes opaque white blocks into the sprite. The
    # mantis itself is either dark or olive/chroma-rich, so remove only bright,
    # low-saturation pixels for this one action before decontamination/RIFE.
    removed_pale_motion_pixels = 0
    if suppress_pale_motion_artifacts:
        hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
        pale_motion = (alpha > 0) & (hsv[..., 1] < 72) & (hsv[..., 2] > 150)
        removed_pale_motion_pixels = int(pale_motion.sum())
        alpha[pale_motion] = 0
        alpha = remove_tiny_components(alpha)

    foreground = white_decontaminate(rgb, alpha)

    # Replace remaining pale edge pollution with the nearest confident subject
    # colour without hardening the alpha or deleting intentional motion blur.
    pale = (alpha > 0) & (np.linalg.norm(foreground.astype(np.float32) - 255.0, axis=2) < 42)
    confident = (alpha >= 180) & ~pale
    if pale.any() and confident.any():
        _, indices = ndimage.distance_transform_edt(~confident, return_indices=True)
        foreground[pale] = foreground[indices[0][pale], indices[1][pale]]
    foreground[alpha == 0] = 0
    return foreground, alpha, {
        "paleMotionPixelsRemoved": removed_pale_motion_pixels,
    }


def rear_body_bbox(alpha: np.ndarray) -> tuple[int, int, int, int]:
    """Measure the broad abdomen/closed-wing mass, excluding blades and thin legs."""
    binary = (alpha >= 96).astype(np.uint8)
    distance = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    thick = distance >= 5.5
    count, labels = cv2.connectedComponents(thick.astype(np.uint8))
    if count <= 1:
        return bbox(alpha, 96)
    candidates = []
    for label in range(1, count):
        ys, xs = np.where(labels == label)
        if len(xs) < 24:
            continue
        candidates.append((len(xs), int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    if not candidates:
        return bbox(alpha, 96)
    _area, x0, y0, x1, y1 = max(candidates, key=lambda item: item[0])
    return x0, y0, x1, y1


def rear_body_center_x(alpha: np.ndarray) -> float:
    x0, _y0, x1, _y1 = rear_body_bbox(alpha)
    return (x0 + x1 - 1) / 2.0


def choose_width(required: float) -> int:
    for width in SUPPORTED_WIDTHS:
        if width >= required:
            return width
    raise ValueError(f"required cell width {required:.1f} exceeds supported safety widths")


def make_cell(
    rgb: np.ndarray,
    alpha: np.ndarray,
    scale: float,
    cell_width: int,
    anchor: str,
    reference_x: float,
) -> Image.Image:
    x0, y0, x1, y1 = bbox(alpha)
    target_w = max(1, round((x1 - x0) * scale))
    target_h = max(1, round((y1 - y0) * scale))
    crop_rgb = Image.fromarray(rgb[y0:y1, x0:x1], "RGB").resize(
        (target_w, target_h), Image.Resampling.LANCZOS
    )
    crop_alpha = Image.fromarray(alpha[y0:y1, x0:x1], "L").resize(
        (target_w, target_h), Image.Resampling.LANCZOS
    )

    source_anchor_x = rear_body_center_x(alpha) if anchor == "stabilized" else reference_x
    destination_x = round(cell_width / 2 + (x0 - source_anchor_x) * scale)
    destination_y = round(FOOT_Y - (y1 - y0) * scale)
    if destination_x < 0 or destination_y < 0 \
            or destination_x + target_w > cell_width \
            or destination_y + target_h > CELL_HEIGHT:
        raise ValueError(
            f"content {target_w}x{target_h} at ({destination_x},{destination_y}) "
            f"does not fit {cell_width}x{CELL_HEIGHT}"
        )

    rgba = crop_rgb.convert("RGBA")
    rgba.putalpha(crop_alpha)
    cell = Image.new("RGBA", (cell_width, CELL_HEIGHT), (0, 0, 0, 0))
    cell.alpha_composite(rgba, (destination_x, destination_y))
    arr = np.asarray(cell, dtype=np.uint8).copy()
    arr[arr[..., 3] == 0, :3] = 0
    return Image.fromarray(arr, "RGBA")


def validate_cells(cells: list[Image.Image]) -> dict:
    blank = []
    touching = []
    bottoms = []
    transparent_rgb = 0
    semi = 0
    for index, cell in enumerate(cells):
        arr = np.asarray(cell, dtype=np.uint8)
        alpha = arr[..., 3]
        ys, xs = np.where(alpha > ALPHA_BBOX_THRESHOLD)
        if not len(xs):
            blank.append(index)
            continue
        bottoms.append(int(ys.max()))
        if (alpha[:2].any() or alpha[-2:].any() or alpha[:, :2].any() or alpha[:, -2:].any()):
            touching.append(index)
        transparent_rgb += int(((alpha == 0) & (arr[..., :3].max(axis=2) > 0)).sum())
        semi += int(((alpha > 0) & (alpha < 255)).sum())
    return {
        "emptyFrames": blank,
        "touchingFrames": touching,
        "alphaBottomMin": min(bottoms) if bottoms else None,
        "alphaBottomMax": max(bottoms) if bottoms else None,
        "semiTransparentPixels": semi,
        "nonzeroRgbInTransparentPixels": transparent_rgb,
    }


def compose(cells: list[Image.Image], cols: int) -> Image.Image:
    rows = math.ceil(len(cells) / cols)
    sheet = Image.new("RGBA", (cells[0].width * cols, CELL_HEIGHT * rows), (0, 0, 0, 0))
    for index, cell in enumerate(cells):
        sheet.alpha_composite(cell, ((index % cols) * cell.width, (index // cols) * CELL_HEIGHT))
    return sheet


def build_source_action(model, name: str, spec: dict, decoded: list[Image.Image]) -> dict:
    selected = spec["frames"]
    processed = []
    cleanup_reports = []
    source_frame_dir = FRAME_DIR / f"{name}-source"
    source_frame_dir.mkdir(parents=True, exist_ok=True)
    for order, source_index in enumerate(selected):
        original = decoded[source_index]
        original.save(source_frame_dir / f"key-{order:02d}-source-{source_index:03d}.png")
        foreground, alpha, cleanup = cutout(
            model,
            original,
            suppress_pale_motion_artifacts=bool(spec.get("suppressPaleMotionArtifacts")),
        )
        processed.append((foreground, alpha))
        cleanup_reports.append(cleanup)
        print(f"[mantis] {name}: BiRefNet {order + 1}/{len(selected)} source={source_index}", flush=True)

    reference_alpha = processed[0][1]
    rear_x0, _rear_y0, rear_x1, _rear_y1 = rear_body_bbox(reference_alpha)
    source_rear_width = max(1, rear_x1 - rear_x0)
    scale = TARGET_REAR_BODY_WIDTH / source_rear_width
    reference_x = rear_body_center_x(reference_alpha)

    spans = []
    for _rgb, alpha in processed:
        x0, _y0, x1, _y1 = bbox(alpha)
        anchor_x = rear_body_center_x(alpha) if spec["anchor"] == "stabilized" else reference_x
        spans.append(((x0 - anchor_x) * scale, (x1 - anchor_x) * scale))
    half_span = max(max(abs(left), abs(right)) for left, right in spans)
    cell_width = choose_width(2 * (half_span + EDGE_PAD))
    cells = [
        make_cell(rgb, alpha, scale, cell_width, spec["anchor"], reference_x)
        for rgb, alpha in processed
    ]
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    source_path = SOURCE_DIR / f"{name}.png"
    compose(cells, spec["sourceCols"]).save(source_path, optimize=True, compress_level=9)

    report = {
        "video": str(spec["video"].relative_to(ROOT)),
        "decodedFrameCount": len(decoded),
        "sourceFrames": selected,
        "normalization": "fixed per-action rear-body core width; thin sickles, legs and antennae excluded",
        "sourceRearBodyWidth": source_rear_width,
        "targetRearBodyWidth": TARGET_REAR_BODY_WIDTH,
        "scale": scale,
        "anchor": spec["anchor"],
        "frameWidth": cell_width,
        "frameHeight": CELL_HEIGHT,
        "columns": spec["sourceCols"],
        "rows": math.ceil(len(cells) / spec["sourceCols"]),
        "frameCount": len(cells),
        "sourceFrameRate": spec["sourceFrameRate"],
        "footY": FOOT_Y,
        "paleMotionArtifactCleanup": {
            "enabled": bool(spec.get("suppressPaleMotionArtifacts")),
            "removedPixelsPerSourceFrame": [
                item["paleMotionPixelsRemoved"] for item in cleanup_reports
            ],
            "removedPixelsTotal": sum(
                item["paleMotionPixelsRemoved"] for item in cleanup_reports
            ),
        },
        "validation": validate_cells(cells),
        "output": str(source_path.relative_to(ROOT)),
    }
    REPORT_SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_SOURCE_DIR / f"{name}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return report


def interpolate_action(name: str, spec: dict, source_report: dict) -> dict:
    source_path = ROOT / source_report["output"]
    output_path = FINAL_DIR / f"{name}.png"
    report_path = REPORT_FINAL_DIR / f"{name}-rife.json"
    action_preview = PREVIEW_DIR / name
    command = [
        sys.executable,
        str(RIFE_TOOL),
        "--sheet", str(source_path),
        "--out", str(output_path),
        "--name", f"reed-shadow-sickle-mantis-{name.replace('_', '-')}",
        "--frame-width", str(source_report["frameWidth"]),
        "--frame-height", str(source_report["frameHeight"]),
        "--cols", str(source_report["columns"]),
        "--frame-count", str(source_report["frameCount"]),
        "--frame-rate", str(source_report["sourceFrameRate"]),
        "--mode", spec["mode"],
        "--out-cols", "8",
        "--preview-dir", str(action_preview),
        "--report", str(report_path),
        "--rife", str(RIFE_EXE),
        "--repair-red-outliers",
    ]
    subprocess.run(command, check=True)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(output_path, RUNTIME_DIR / spec["runtime"])
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--action",
        choices=sorted(ACTIONS),
        help="Rebuild only one action and preserve the other manifest entries.",
    )
    args = parser.parse_args()
    if not RIFE_EXE.exists():
        raise SystemExit(f"RIFE executable missing: {RIFE_EXE}")
    selected_actions = {
        name: spec for name, spec in ACTIONS.items()
        if args.action is None or name == args.action
    }
    decoded = {name: decode(spec["video"]) for name, spec in selected_actions.items()}
    for name, spec in selected_actions.items():
        required = max(spec["frames"])
        if len(decoded[name]) <= required:
            raise ValueError(f"{name}: decoded {len(decoded[name])} frames, needs source {required}")

    model = get_model()
    source_reports = {
        name: build_source_action(model, name, spec, decoded[name])
        for name, spec in selected_actions.items()
    }
    final_reports = {
        name: interpolate_action(name, spec, source_reports[name])
        for name, spec in selected_actions.items()
    }

    manifest_path = ROOT / "sprite-sheet-manifest.json"
    existing_manifest = {}
    if args.action and manifest_path.exists():
        existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    actions = dict(existing_manifest.get("actions") or {})
    for name, spec in selected_actions.items():
        source = source_reports[name]
        final = final_reports[name]
        contact_source = spec.get("contactSourceFrame")
        contact_source_index = spec["frames"].index(contact_source) if contact_source is not None else None
        actions[name] = {
            "runtime": str((RUNTIME_DIR / spec["runtime"]).relative_to(REPO)).replace("\\", "/"),
            "sourceSheet": source["output"].replace("\\", "/"),
            "finalSheet": str((FINAL_DIR / f"{name}.png").relative_to(ROOT)).replace("\\", "/"),
            "previewGif": str((PREVIEW_DIR / name / f"reed-shadow-sickle-mantis-{name.replace('_', '-')}-interpolated.gif").relative_to(ROOT)).replace("\\", "/"),
            "contactSheet": str((PREVIEW_DIR / name / f"reed-shadow-sickle-mantis-{name.replace('_', '-')}-interpolated-contact.png").relative_to(ROOT)).replace("\\", "/"),
            "rifeReport": str((REPORT_FINAL_DIR / f"{name}-rife.json").relative_to(ROOT)).replace("\\", "/"),
            "frameWidth": final["frameWidth"],
            "frameHeight": final["frameHeight"],
            "columns": final["cols"],
            "rows": final["rows"],
            "frameCount": final["outputFrameCount"],
            "frameRate": final["outputFrameRate"],
            "durationMs": round(final["outputFrameCount"] * 1000 / final["outputFrameRate"]),
            "footY": FOOT_Y,
            "referenceCell": REFERENCE_CELL,
            "repeat": -1 if spec["mode"] == "loop" else 0,
            "sourceFrames": spec["frames"],
            "contactFrame": contact_source_index * 2 if contact_source_index is not None else None,
            "contactSourceFrame": contact_source,
            "validation": final["validation"],
        }

    manifest = {
        "asset": "reed-shadow-sickle-mantis",
        "displayName": "芦影镰螳",
        "pipeline": "approved MiniMax H3 -> BiRefNet -> fan-sweep pale-motion cleanup -> rear-body fixed scale -> RIFE v4.6 RGBA 2x",
        "normalization": "rear-body core width excludes long sickles, thin legs and antennae",
        "targetRearBodyWidth": TARGET_REAR_BODY_WIDTH,
        "footY": FOOT_Y,
        "referenceCell": REFERENCE_CELL,
        "runtimeAssetRoot": str(RUNTIME_DIR.relative_to(REPO)).replace("\\", "/"),
        "runtimeInstalled": True,
        "actions": actions,
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
