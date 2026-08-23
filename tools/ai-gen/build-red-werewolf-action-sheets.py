#!/usr/bin/env python3
"""Build the transformed RedWolfKing action sheets from approved H3 clips."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys

import av
import numpy as np
from PIL import Image
from scipy import ndimage


TOOLS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS_DIR))
from transparent_cutout import build_alpha, decontaminate, detect_bg_color  # noqa: E402


CELL = 640
FOOT_Y = 590
CENTER_X = 320
REFERENCE_CONTENT_H = 413  # transform.png final frame alpha height

SPECS = {
    "idle": {
        "video": "red_wolf_king_werewolf_idle_h3.mp4",
        "output": "werewolf_idle.png",
        "frames": np.linspace(0, 117, 20).round().astype(int).tolist(),
        "cols": 5,
        "anchor": "torso",
        "preview_ms": 90,
    },
    "running": {
        # Historical 23-frame low-chase source. The current runtime sheet is the
        # user-adjusted 12-frame transparent override; do not overwrite it unless
        # intentionally rebuilding the running asset. f34 and f101 are the same
        # phase, so the source extraction omits duplicate f101.
        "video": "red_wolf_king_werewolf_running_chase_h3.mp4",
        "output": "werewolf_running.png",
        "frames": list(range(34, 101, 3)),
        "cols": 6,
        "anchor": "torso",
        "preview_ms": 90,
    },
    "attacking": {
        "video": "red_wolf_king_werewolf_attacking_h3.mp4",
        "output": "werewolf_attacking.png",
        "frames": [0, 6, 11, 16, 21, 26, 31, 34, 37, 40, 43,
                   46, 49, 52, 55, 58, 61, 65, 70, 76, 84],
        "cols": 6,
        "anchor": "torso",
        "preview_ms": 55,
    },
    "howling": {
        "video": "red_wolf_king_werewolf_howling_h3.mp4",
        "output": "werewolf_howling.png",
        "frames": [0, 7, 14, 21, 28, 34, 40, 46, 52, 58,
                   64, 70, 76, 82, 88, 94, 100, 108, 116, 123],
        "cols": 5,
        "anchor": "torso",
        "preview_ms": 75,
    },
    "dying": {
        "video": "red_wolf_king_werewolf_dying_h3.mp4",
        "output": "werewolf_dying.png",
        "frames": [0, 4, 8, 12, 16, 20, 24, 28, 32, 36,
                   40, 44, 48, 52, 56, 60, 64, 68, 74, 82],
        "cols": 5,
        "anchor": "source",
        "preview_ms": 100,
    },
}


def decode(path: Path) -> list[np.ndarray]:
    container = av.open(str(path))
    stream = container.streams.video[0]
    stream.thread_type = "AUTO"
    return [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]


def cutout(rgb: np.ndarray) -> tuple[Image.Image, tuple[int, int, int, int]]:
    bg = detect_bg_color(rgb)
    alpha = build_alpha(rgb, bg, tol=55, soft=38, feather=0.65, keep_largest=True)
    foreground = decontaminate(rgb, alpha, bg)
    alpha_u8 = np.clip(alpha * 255, 0, 255).astype(np.uint8)
    rgba = np.dstack([foreground, alpha_u8])
    rgba[alpha_u8 == 0, :3] = 0
    ys, xs = np.where(alpha_u8 > 12)
    if not len(xs):
        raise RuntimeError("selected frame contains no foreground")
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return Image.fromarray(rgba, "RGBA"), box


def torso_anchor(alpha: np.ndarray, box: tuple[int, int, int, int]) -> float:
    x0, y0, x1, y1 = box
    band0 = y0 + round((y1 - y0) * 0.22)
    band1 = y0 + round((y1 - y0) * 0.58)
    ys, xs = np.where(alpha[band0:band1] > 20)
    if not len(xs):
        return (x0 + x1 - 1) / 2
    # Only Y was sliced; X coordinates already refer to the full source frame.
    return float(np.median(xs))


def remove_cyan_spill(image: Image.Image) -> Image.Image:
    """Replace H3 cyan-screen spill with the nearest real red/black fur color."""
    arr = np.asarray(image).copy()
    rgb = arr[:, :, :3].astype(np.int16)
    alpha = arr[:, :, 3]
    cyan = ((alpha > 4)
            & (rgb[:, :, 1] > rgb[:, :, 0] + 20)
            & (rgb[:, :, 2] > rgb[:, :, 0] + 20))
    valid = (alpha > 8) & ~cyan
    if cyan.any() and valid.any():
        _, nearest = ndimage.distance_transform_edt(~valid, return_indices=True)
        arr[cyan, :3] = arr[nearest[0][cyan], nearest[1][cyan], :3]
        arr[cyan & (alpha < 24)] = 0
    arr[arr[:, :, 3] == 0, :3] = 0
    return Image.fromarray(arr, "RGBA")


def place(rgba: Image.Image, box: tuple[int, int, int, int], scale: float,
          anchor_mode: str, source_anchor_x: float) -> tuple[Image.Image, dict]:
    x0, y0, x1, y1 = box
    crop = rgba.crop(box)
    width = max(1, round(crop.width * scale))
    height = max(1, round(crop.height * scale))
    resized = crop.resize((width, height), Image.Resampling.LANCZOS)
    alpha = np.asarray(rgba.getchannel("A"))
    if anchor_mode == "torso":
        anchor = torso_anchor(alpha, box)
        ox = round(CENTER_X - (anchor - x0) * scale)
        # Keep extreme claw/tail poses whole without reintroducing source drift.
        ox = max(4, min(ox, CELL - width - 4))
    else:
        # Preserve authored lateral motion relative to the exact reference pose.
        ox = round(CENTER_X + (x0 - source_anchor_x) * scale)
    oy = FOOT_Y - height + 1
    if width > CELL - 8 or ox < 4 or oy < 4 or ox + width > CELL - 4 or oy + height > CELL - 4:
        raise RuntimeError(f"frame does not fit 640 cell: {width}x{height} at {ox},{oy}")
    canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    canvas.alpha_composite(resized, (ox, oy))
    canvas = remove_cyan_spill(canvas)
    arr = np.asarray(canvas).copy()
    arr[arr[:, :, 3] == 0, :3] = 0
    return Image.fromarray(arr, "RGBA"), {
        "sourceBox": list(box),
        "placedBox": [ox, oy, ox + width, oy + height],
    }


def save_preview(cells: list[Image.Image], out: Path, duration: int) -> None:
    frames = []
    bg = Image.new("RGB", (CELL, CELL), (34, 42, 48))
    for cell in cells:
        frame = bg.copy()
        frame.paste(cell, mask=cell.getchannel("A"))
        frames.append(frame.resize((320, 320), Image.Resampling.LANCZOS))
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=duration, loop=0)


def build_action(name: str, spec: dict, videos_dir: Path, out_dir: Path,
                 preview_dir: Path) -> dict:
    video_path = videos_dir / spec["video"]
    frames = decode(video_path)
    if max(spec["frames"]) >= len(frames):
        raise RuntimeError(f"{name}: source frame index exceeds {len(frames)}")

    reference_rgba, reference_box = cutout(frames[0])
    scale = REFERENCE_CONTENT_H / (reference_box[3] - reference_box[1])
    reference_alpha = np.asarray(reference_rgba.getchannel("A"))
    source_anchor_x = torso_anchor(reference_alpha, reference_box)

    cells = []
    placements = []
    for cell_index, frame_index in enumerate(spec["frames"]):
        rgba, box = cutout(frames[frame_index])
        cell, placement = place(rgba, box, scale, spec["anchor"], source_anchor_x)
        cells.append(cell)
        placements.append({"cell": cell_index, "sourceFrame": frame_index, **placement})

    rows = math.ceil(len(cells) / spec["cols"])
    sheet = Image.new("RGBA", (spec["cols"] * CELL, rows * CELL), (0, 0, 0, 0))
    for index, cell in enumerate(cells):
        sheet.alpha_composite(cell, ((index % spec["cols"]) * CELL, (index // spec["cols"]) * CELL))
    out_path = out_dir / spec["output"]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)
    preview_dir.mkdir(parents=True, exist_ok=True)
    preview_path = preview_dir / f"red-werewolf-{name}.gif"
    save_preview(cells, preview_path, spec["preview_ms"])

    alpha = np.asarray(sheet.getchannel("A"))
    nonempty = []
    touching = 0
    for index in range(spec["cols"] * rows):
        row, col = divmod(index, spec["cols"])
        cell_alpha = alpha[row * CELL:(row + 1) * CELL, col * CELL:(col + 1) * CELL]
        if (cell_alpha > 12).any():
            nonempty.append(index)
            edge = np.concatenate([cell_alpha[:4].ravel(), cell_alpha[-4:].ravel(),
                                   cell_alpha[:, :4].ravel(), cell_alpha[:, -4:].ravel()])
            touching += int((edge > 12).any())
    return {
        "video": str(video_path),
        "output": str(out_path),
        "preview": str(preview_path),
        "sourceFrameCount": len(frames),
        "sampleIndexes": spec["frames"],
        "layout": {"cols": spec["cols"], "rows": rows, "frames": len(cells),
                   "frameWidth": CELL, "frameHeight": CELL, "footY": FOOT_Y},
        "fixedScale": scale,
        "anchor": spec["anchor"],
        "nonemptyCells": nonempty,
        "touchingCells": touching,
        "transparentNonzeroRgb": int(((alpha == 0) & (np.asarray(sheet)[:, :, :3].max(axis=2) > 0)).sum()),
        "placements": placements,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--videos", type=Path, default=Path("assets/videos"))
    parser.add_argument("--out", type=Path, default=Path("assets/enemies/red_wolf_king"))
    parser.add_argument("--previews", type=Path, default=Path("tools/ai-gen/red-werewolf-previews"))
    parser.add_argument("--report", type=Path, default=Path("tools/ai-gen/red-werewolf-action-report.json"))
    args = parser.parse_args()

    report = {name: build_action(name, spec, args.videos, args.out, args.previews)
              for name, spec in SPECS.items()}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({name: data["layout"] | {
        "touchingCells": data["touchingCells"],
        "transparentNonzeroRgb": data["transparentNonzeroRgb"],
    } for name, data in report.items()}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
