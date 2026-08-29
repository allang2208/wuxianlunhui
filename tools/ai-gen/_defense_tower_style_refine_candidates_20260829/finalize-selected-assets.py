#!/usr/bin/env python3
"""Pack selected candidate 3 and keep formal promotion as a separate explicit step."""
from pathlib import Path
import hashlib
import json

from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
RENDERS = HERE / "renders"
PREVIEWS = HERE / "previews"
RAW_FRAMES = RENDERS / "selected_arm_frames_raw"

BASE_REFERENCE = ROOT / "assets/terrain/obstacle_defense_tower.png"
ARM_REFERENCE = ROOT / "assets/terrain/obstacle_defense_tower_arm_frames.png"
SELECTED_BASE_SOURCE = RENDERS / "candidate_3_base_locked.png"
SELECTED_BASE = RENDERS / "selected_obstacle_defense_tower.png"
SELECTED_ARM_SHEET = RENDERS / "selected_obstacle_defense_tower_arm_frames.png"

FRAME_COUNT = 48
FRAME_WIDTH = 261
FRAME_HEIGHT = 164
FRAME_COLUMNS = 8
FRAME_ROWS = (FRAME_COUNT + FRAME_COLUMNS - 1) // FRAME_COLUMNS
FIXED_CROP = (330, 430, 591, 594)


def frame_box(index):
    column = index % FRAME_COLUMNS
    row = index // FRAME_COLUMNS
    return (
        column * FRAME_WIDTH,
        row * FRAME_HEIGHT,
        (column + 1) * FRAME_WIDTH,
        (row + 1) * FRAME_HEIGHT,
    )


def pack_arm_frames(reference_sheet):
    expected_size = (FRAME_WIDTH * FRAME_COLUMNS, FRAME_HEIGHT * FRAME_ROWS)
    if reference_sheet.size != expected_size:
        raise ValueError(f"unexpected arm reference size: {reference_sheet.size}")
    raw_paths = [RAW_FRAMES / f"frame_{index:03d}.png" for index in range(FRAME_COUNT)]
    if not all(path.exists() for path in raw_paths):
        # 定稿瘦身会删除可再生成的 48 张 1024² 原始帧。运行时表就是已晋级的
        # candidate_3，此时直接归档其 8×6 表，避免用旧的一行式候选表污染报告。
        return reference_sheet.copy(), [True] * FRAME_COUNT
    sheet = Image.new("RGBA", expected_size, (0, 0, 0, 0))
    alpha_matches = []
    for index, raw_path in enumerate(raw_paths):
        raw = Image.open(raw_path).convert("RGBA")
        frame = raw.crop(FIXED_CROP)
        if frame.size != (FRAME_WIDTH, FRAME_HEIGHT):
            raise ValueError(f"unexpected crop size for frame {index}: {frame.size}")
        reference = reference_sheet.crop(frame_box(index))
        frame.putalpha(reference.getchannel("A"))
        alpha_matches.append(
            frame.getchannel("A").tobytes() == reference.getchannel("A").tobytes()
        )
        sheet.alpha_composite(
            frame,
            ((index % FRAME_COLUMNS) * FRAME_WIDTH, (index // FRAME_COLUMNS) * FRAME_HEIGHT),
        )
    return sheet, alpha_matches


def font(size, bold=False):
    filename = "msyhbd.ttc" if bold else "msyh.ttc"
    try:
        return ImageFont.truetype(f"C:/Windows/Fonts/{filename}", size)
    except OSError:
        return ImageFont.load_default()


def make_arm_preview(sheet):
    indices = list(range(0, FRAME_COUNT, 6))
    cell_width, cell_height = 184, 138
    preview = Image.new(
        "RGBA",
        (cell_width * 4, cell_height * 2 + 42),
        (18, 22, 27, 255),
    )
    draw = ImageDraw.Draw(preview, "RGBA")
    draw.text(
        (14, 8),
        "3 号定稿机械臂：8 个方向抽样 / 48 帧",
        font=font(18, True),
        fill=(232, 237, 241, 255),
    )
    for order, index in enumerate(indices):
        frame = sheet.crop(frame_box(index))
        frame.thumbnail((150, 94), Image.Resampling.LANCZOS)
        col, row = order % 4, order // 4
        x0, y0 = col * cell_width, 42 + row * cell_height
        draw.rounded_rectangle(
            (x0 + 5, y0 + 5, x0 + cell_width - 5, y0 + cell_height - 5),
            radius=8,
            fill=(33, 39, 46, 255),
            outline=(83, 94, 104, 255),
            width=1,
        )
        preview.alpha_composite(
            frame,
            (x0 + (cell_width - frame.width) // 2,
             y0 + 12 + (94 - frame.height) // 2),
        )
        draw.text(
            (x0 + 12, y0 + 107),
            f"frame {index:02d} / {index * 7.5:.1f} deg",
            font=font(12),
            fill=(180, 192, 201, 255),
        )
    return preview


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative(path):
    return str(path.relative_to(ROOT)).replace("\\", "/")


def main():
    RENDERS.mkdir(parents=True, exist_ok=True)
    PREVIEWS.mkdir(parents=True, exist_ok=True)

    base_reference = Image.open(BASE_REFERENCE).convert("RGBA")
    selected_base = Image.open(SELECTED_BASE_SOURCE).convert("RGBA")
    if selected_base.size != base_reference.size:
        raise ValueError(f"unexpected selected base size: {selected_base.size}")
    base_alpha_exact = (
        selected_base.getchannel("A").tobytes()
        == base_reference.getchannel("A").tobytes()
    )
    if not base_alpha_exact:
        raise ValueError("selected base alpha differs from the accepted runtime base")
    selected_base.save(SELECTED_BASE)

    arm_reference = Image.open(ARM_REFERENCE).convert("RGBA")
    arm_sheet, alpha_matches = pack_arm_frames(arm_reference)
    if not all(alpha_matches):
        raise ValueError("one or more selected arm frames differ from accepted alpha")
    arm_sheet.save(SELECTED_ARM_SHEET)

    selected_world_preview = PREVIEWS / "selected_candidate_3_runtime_preview.png"
    Image.open(PREVIEWS / "candidate_3_world_actual_size.png").save(selected_world_preview)
    selected_arm_preview = PREVIEWS / "selected_candidate_3_arm_8_angles.png"
    make_arm_preview(arm_sheet).save(selected_arm_preview)

    report = {
        "selected": "candidate_3",
        "label": "现代防御型：冷灰预制混凝土 + 蓝黑钢",
        "runtimeAssetsTouchedByThisScript": False,
        "promotionReady": True,
        "promotedToRuntime": True,
        "base": {
            "path": relative(SELECTED_BASE),
            "size": list(selected_base.size),
            "alphaExact": base_alpha_exact,
            "sha256": sha256(SELECTED_BASE),
        },
        "armSheet": {
            "path": relative(SELECTED_ARM_SHEET),
            "size": list(arm_sheet.size),
            "frames": FRAME_COUNT,
            "frameSize": [FRAME_WIDTH, FRAME_HEIGHT],
            "grid": [FRAME_COLUMNS, FRAME_ROWS],
            "allFrameAlphaExact": all(alpha_matches),
            "sha256": sha256(SELECTED_ARM_SHEET),
        },
        "previews": [
            relative(selected_world_preview),
            relative(selected_arm_preview),
        ],
        "invariants": {
            "geometry": "unchanged",
            "camera": "unchanged",
            "baseCanvas": "unchanged",
            "armFrameCanvas": "unchanged",
            "transparentArea": "locked to prior runtime assets",
            "collisionAndGameplayConfig": "not touched",
        },
    }
    with (HERE / "selection-report.json").open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
