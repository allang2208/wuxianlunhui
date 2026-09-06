#!/usr/bin/env python3
"""Build accepted hamster-riot-squad videos into aligned transparent source sheets."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
HELPER_PATH = REPO / "tools" / "ai-gen" / "_hamster_sniper_20260826" / "build-sniper-source-sheets.py"
SPEC = importlib.util.spec_from_file_location("hamster_riot_sheet_helper", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import sprite helper: {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)

FRAME_WIDTH = 512
FRAME_HEIGHT = 512
FEET_Y = 351
TARGET_BODY_HEIGHT = 129
COLS = 8


@dataclass(frozen=True)
class ActionSpec:
    name: str
    video_name: str
    indices: tuple[int, ...]
    frame_rate: float
    repeat: int
    horizontal_mode: str
    vertical_mode: str


SPECS = (
    ActionSpec(
        "idle",
        "hamster_riot_squad_idle_h3_v02.mp4",
        (0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110),
        8.0,
        -1,
        "center-body",
        "body-feet",
    ),
    ActionSpec(
        "walking",
        "hamster_riot_squad_moving_h3_v04.mp4",
        # One complete native stride, endpoint 96 excluded to avoid a duplicate hold.
        tuple(range(72, 96, 2)),
        12.0,
        -1,
        "center-body",
        "body-feet",
    ),
    ActionSpec(
        "attacking",
        "hamster_riot_squad_attacking_h3_v01.mp4",
        (0, 8, 16, 24, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 96, 104),
        12.0,
        0,
        "preserve-source",
        "body-feet",
    ),
    ActionSpec(
        "dying",
        "hamster_riot_squad_dying_h3_v01.mp4",
        (0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 72, 120),
        10.0,
        0,
        "preserve-source",
        "content-ground",
    ),
)


def compose(cells: list[np.ndarray]) -> np.ndarray:
    rows = math.ceil(len(cells) / COLS)
    sheet = np.zeros((rows * FRAME_HEIGHT, COLS * FRAME_WIDTH, 4), dtype=np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, COLS)
        sheet[
            row * FRAME_HEIGHT:(row + 1) * FRAME_HEIGHT,
            col * FRAME_WIDTH:(col + 1) * FRAME_WIDTH,
        ] = cell
    return sheet


def save_scale_compare(cell: np.ndarray, output: Path) -> None:
    reference_sheet = Image.open(
        REPO / "assets" / "companions" / "hamster_phalanx" / "idle.png"
    ).convert("RGBA")
    reference = np.asarray(reference_sheet.crop((0, 0, FRAME_WIDTH, FRAME_HEIGHT)))
    compare = Image.new("RGB", (1024, 548), "#20242a")
    compare.paste(HELPER.checker(reference), (0, 0))
    compare.paste(HELPER.checker(cell), (512, 0))
    draw = ImageDraw.Draw(compare)
    draw.text((12, 520), "hamster phalanx / infantry body reference", fill="white")
    draw.text((524, 520), "hamster riot squad / matched effective body height", fill="white")
    compare.save(output)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--actions", nargs="+", choices=[spec.name for spec in SPECS])
    args = parser.parse_args()
    selected = [spec for spec in SPECS if not args.actions or spec.name in args.actions]
    report_path = ROOT / "source-sheet-report.json"
    previous = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else None
    if args.actions and previous is None:
        raise RuntimeError("A partial rebuild needs the existing shared scale report.")
    videos = {
        spec.name: HELPER.BASE.decode_video(ROOT / "videos" / spec.video_name)
        for spec in selected
    }
    source_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "source-sheets"
    frame_dir = ROOT / "frames" / "birefnet-source"
    source_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    frame_dir.mkdir(parents=True, exist_ok=True)

    model = HELPER.BASE.get_model()
    cache: dict[tuple[str, int], np.ndarray] = {}
    removed_pixels: dict[str, dict[int, int]] = {spec.name: {} for spec in selected}
    for spec in selected:
        action_dir = frame_dir / spec.name
        action_dir.mkdir(parents=True, exist_ok=True)
        frames = videos[spec.name][0]
        for source_index in spec.indices:
            rgba = HELPER.BASE.cutout_rgba(frames[source_index], model)
            rgba, removed = HELPER.strip_small_cutout_components(rgba, min_source_area=600)
            rgba[rgba[..., 3] == 0, :3] = 0
            cache[(spec.name, source_index)] = rgba
            removed_pixels[spec.name][source_index] = removed
            Image.fromarray(rgba, "RGBA").save(
                action_dir / f"source-{source_index:03d}.png",
                optimize=True,
                compress_level=9,
            )
            print(f"[riot-sheet] {spec.name} BiRefNet f{source_index}", flush=True)

    if args.actions:
        reference_body_height = previous["referenceSourceBodyHeight"]
        fixed_scale = previous["fixedScaleAcrossAllActions"]
    else:
        idle_reference = cache[("idle", SPECS[0].indices[0])]
        _, body_y0, _, body_y1 = HELPER.opened_body_bbox(idle_reference)
        reference_body_height = body_y1 - body_y0 + 1
        fixed_scale = TARGET_BODY_HEIGHT / reference_body_height

    report: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "acceptedSources": {
            "idle": SPECS[0].video_name,
            "walking": SPECS[1].video_name,
            "attacking": SPECS[2].video_name,
            "dying": SPECS[3].video_name,
        },
        "frameWidth": FRAME_WIDTH,
        "frameHeight": FRAME_HEIGHT,
        "feetY": FEET_Y,
        "targetEffectiveBodyHeight": TARGET_BODY_HEIGHT,
        "referenceSourceBodyHeight": reference_body_height,
        "fixedScaleAcrossAllActions": fixed_scale,
        "scaleRule": "effective hamster body only; riot shield and shotgun excluded",
        "smallComponentCleanup": {
            "purpose": "remove detached shell casings and generation specks while preserving the connected actor, shield and shotgun",
            "minimumSourceComponentArea": 600,
            "removedAlphaPixelsBySourceFrame": removed_pixels,
        },
        "actions": {},
    }
    if args.actions:
        report = previous
        report["smallComponentCleanup"]["removedAlphaPixelsBySourceFrame"].update(removed_pixels)

    action_cells: dict[str, list[np.ndarray]] = {}
    for spec in selected:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        reference_anchor = (
            None if spec.horizontal_mode == "center-body" else HELPER.body_anchor_x(rgba_frames[0])
        )
        cells = [
            HELPER.place_cell(
                rgba,
                fixed_scale,
                FRAME_WIDTH,
                spec.horizontal_mode,
                spec.vertical_mode,
                reference_anchor,
            )
            for rgba in rgba_frames
        ]
        action_cells[spec.name] = cells
        sheet_path = source_dir / f"{spec.name}.png"
        Image.fromarray(compose(cells), "RGBA").save(
            sheet_path, optimize=True, compress_level=9
        )
        HELPER.save_previews(spec, cells, preview_dir)
        validation = HELPER.BASE.validate_cells(cells, spec.repeat)
        validation.update(HELPER.body_metrics(cells))
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        )
        report["actions"][spec.name] = {
            "source": f"videos/{spec.video_name}",
            "sourceFrameRate": videos[spec.name][1],
            "sourceIndices": list(spec.indices),
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": FRAME_WIDTH,
            "frameHeight": FRAME_HEIGHT,
            "cols": COLS,
            "rows": math.ceil(len(cells) / COLS),
            "previewFrameRate": spec.frame_rate,
            "repeat": spec.repeat,
            "horizontalMode": spec.horizontal_mode,
            "verticalMode": spec.vertical_mode,
            "validation": validation,
        }

    if "idle" in action_cells:
        save_scale_compare(action_cells["idle"][0], preview_dir / "body-scale-comparison.png")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
