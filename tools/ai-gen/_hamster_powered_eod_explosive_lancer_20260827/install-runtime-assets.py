#!/usr/bin/env python3
"""Install approved RIFE sheets and derive the recruitment icon."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE = ROOT / "sheets" / "interpolated"
TARGET = REPO / "assets" / "companions" / "hamster_powered_eod_explosive_lancer"
ICON = REPO / "assets" / "ui" / "unit-icons" / "hamster-powered-eod-explosive-lancer.png"
RUNTIME_PREVIEWS = ROOT / "previews" / "runtime"
FRAME_HEIGHT = 512
SOURCE_COLS = 8
ACTION_SPECS = {
    "idle.png": {"source": "idle.png", "frame_width": 512, "frame_count": 20, "frame_rate": 12, "mode": "center", "cols": 5},
    "running.png": {"source": "running.png", "frame_width": 512, "frame_count": 22, "frame_rate": 24, "mode": "center", "cols": 6},
    "attacking.png": {"source": "lance_attacking.png", "frame_width": 1024, "frame_count": 39, "frame_rate": 24, "mode": "preserve", "cols": 5},
    "charging.png": {"source": "charge_attacking.png", "frame_width": 1280, "frame_count": 49, "frame_rate": 24, "mode": "center", "cols": 7},
    "dying.png": {"source": "dying.png", "frame_width": 640, "frame_count": 35, "frame_rate": 20, "mode": "preserve", "cols": 7},
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_icon(idle_sheet: Path, frame_width: int) -> None:
    frame = Image.open(idle_sheet).convert("RGBA").crop((0, 0, frame_width, FRAME_HEIGHT))
    # 图标突出骑乘主体；长矛是识别配件，但不允许把细长矛杆计入图标缩放后压小角色。
    center_x = frame_width // 2
    body_window = frame.crop((max(0, center_x - 160), 96, min(frame_width, center_x + 160), 416))
    bbox = body_window.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("idle frame 0 body window is empty")
    subject = body_window.crop(bbox)
    scale = min(232 / subject.width, 232 / subject.height)
    subject = subject.resize(
        (max(1, round(subject.width * scale)), max(1, round(subject.height * scale))),
        Image.Resampling.LANCZOS,
    )
    icon = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    icon.alpha_composite(subject, ((256 - subject.width) // 2, (256 - subject.height) // 2))
    ICON.parent.mkdir(parents=True, exist_ok=True)
    icon.save(ICON, optimize=True, compress_level=9)


def alpha_bbox(frame: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(frame[..., 3] > 16)
    if not len(xs):
        raise RuntimeError("runtime source contains an empty frame")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def body_anchor_x(frame: np.ndarray) -> float:
    x0, y0, x1, y1 = alpha_bbox(frame)
    top = y0 + round((y1 - y0) * 0.30)
    bottom = y0 + round((y1 - y0) * 0.78)
    ys, xs = np.where(frame[top:bottom, x0:x1, 3] > 40)
    return float(np.median(xs + x0)) if len(xs) else (x0 + x1) / 2


def round_width(value: float) -> int:
    return max(384, int(math.ceil(value / 128) * 128))


def extract_cells(sheet: Image.Image, frame_width: int, frame_count: int) -> list[np.ndarray]:
    cells = []
    for index in range(frame_count):
        col = index % SOURCE_COLS
        row = index // SOURCE_COLS
        cells.append(np.asarray(sheet.crop((
            col * frame_width,
            row * FRAME_HEIGHT,
            (col + 1) * frame_width,
            (row + 1) * FRAME_HEIGHT,
        )).convert("RGBA")).copy())
    return cells


def optimize_cells(cells: list[np.ndarray], mode: str) -> tuple[list[np.ndarray], int]:
    boxes = [alpha_bbox(frame) for frame in cells]
    anchors = [body_anchor_x(frame) for frame in cells]
    if mode == "center":
        half_span = max(
            max(anchor - box[0], box[2] - anchor)
            for frame, box, anchor in zip(cells, boxes, anchors)
        )
        frame_width = round_width(half_span * 2 + 40)
        target_anchors = anchors
    else:
        reference_anchor = anchors[0]
        left = min(box[0] for box in boxes)
        right = max(box[2] for box in boxes)
        frame_width = round_width(max(reference_anchor - left, right - reference_anchor) * 2 + 40)
        target_anchors = [reference_anchor] * len(cells)

    optimized = []
    for frame, box, anchor in zip(cells, boxes, target_anchors):
        x0, _, x1, _ = box
        offset = round(frame_width / 2 - anchor)
        if x0 + offset < 8 or x1 + offset > frame_width - 8:
            raise RuntimeError(f"optimized frame would clip: {x0 + offset}..{x1 + offset}/{frame_width}")
        output = np.zeros((FRAME_HEIGHT, frame_width, 4), dtype=np.uint8)
        src_left = max(0, -offset)
        src_right = min(frame.shape[1], frame_width - offset)
        output[:, src_left + offset:src_right + offset] = frame[:, src_left:src_right]
        output[output[..., 3] == 0, :3] = 0
        optimized.append(output)
    return optimized, frame_width


def compose(cells: list[np.ndarray], frame_width: int, cols: int) -> Image.Image:
    rows = math.ceil(len(cells) / cols)
    sheet = np.zeros((rows * FRAME_HEIGHT, cols * frame_width, 4), dtype=np.uint8)
    for index, frame in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[row * FRAME_HEIGHT:(row + 1) * FRAME_HEIGHT,
              col * frame_width:(col + 1) * frame_width] = frame
    return Image.fromarray(sheet, "RGBA")


def save_runtime_preview(cells: list[np.ndarray], name: str, frame_rate: int) -> Path:
    RUNTIME_PREVIEWS.mkdir(parents=True, exist_ok=True)
    frames = []
    for cell in cells:
        rgba = Image.fromarray(cell, "RGBA")
        scale = min(1.0, 512 / rgba.width, 256 / rgba.height)
        size = (max(1, round(rgba.width * scale)), max(1, round(rgba.height * scale)))
        rgba = rgba.resize(size, Image.Resampling.LANCZOS)
        checker = Image.new("RGBA", size, (43, 47, 52, 255))
        tile = 16
        pixels = np.asarray(checker).copy()
        yy, xx = np.indices((size[1], size[0]))
        alternate = ((xx // tile + yy // tile) % 2) == 0
        pixels[alternate, :3] = (61, 66, 72)
        checker = Image.fromarray(pixels, "RGBA")
        checker.alpha_composite(rgba)
        frames.append(checker.convert("P", palette=Image.Palette.ADAPTIVE, colors=255))
    destination = RUNTIME_PREVIEWS / f"{name}-runtime.gif"
    frames[0].save(
        destination,
        save_all=True,
        append_images=frames[1:],
        duration=max(1, round(1000 / frame_rate)),
        loop=0,
        disposal=2,
        optimize=False,
    )
    return destination


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    installed = {}
    for target_name, spec in ACTION_SPECS.items():
        source = SOURCE / spec["source"]
        destination = TARGET / target_name
        source_sheet = Image.open(source).convert("RGBA")
        cells = extract_cells(source_sheet, spec["frame_width"], spec["frame_count"])
        optimized, frame_width = optimize_cells(cells, spec["mode"])
        runtime_sheet = compose(optimized, frame_width, spec["cols"])
        if runtime_sheet.width > 8192 or runtime_sheet.height > 8192:
            raise RuntimeError(f"runtime sheet exceeds WebGL-safe dimensions: {runtime_sheet.size}")
        runtime_sheet.save(destination, optimize=True, compress_level=9)
        preview = save_runtime_preview(optimized, destination.stem, spec["frame_rate"])
        installed[target_name] = {
            "source": str(source.relative_to(REPO)).replace("\\", "/"),
            "destination": str(destination.relative_to(REPO)).replace("\\", "/"),
            "frameWidth": frame_width,
            "frameHeight": FRAME_HEIGHT,
            "frameCount": spec["frame_count"],
            "frameRate": spec["frame_rate"],
            "cols": spec["cols"],
            "rows": math.ceil(spec["frame_count"] / spec["cols"]),
            "sheetWidth": runtime_sheet.width,
            "sheetHeight": runtime_sheet.height,
            "horizontalPolicy": "body-centered for runtime movement" if spec["mode"] == "center"
                else "approved source-space trajectory retained",
            "runtimePreview": str(preview.relative_to(REPO)).replace("\\", "/"),
            "sha256": sha256(destination),
        }

    build_icon(TARGET / "idle.png", installed["idle.png"]["frameWidth"])
    config_source = REPO / "data" / "hamster-powered-eod-explosive-lancer-config.json"
    config_public = REPO / "public" / "data" / config_source.name
    report = {
        "source": "sheets/interpolated",
        "pipeline": "BiRefNet-general + RIFE v4.6 RGBA 2x",
        "runtimeAssetDirectory": str(TARGET.relative_to(REPO)).replace("\\", "/"),
        "assets": installed,
        "optimization": "lossless integer recenter/repack; charge camera travel removed because world movement is supplied by AI; no resampling",
        "icon": str(ICON.relative_to(REPO)).replace("\\", "/"),
        "iconSha256": sha256(ICON),
        "configCopiesIdentical": sha256(config_source) == sha256(config_public),
    }
    (ROOT / "runtime-install-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
