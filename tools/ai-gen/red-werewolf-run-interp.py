#!/usr/bin/env python3
"""红狼人低伏追捕跑 RIFE 循环插帧（23 -> 46）。

复用红狼王攻击动画的透明素材插帧协议：RGB 透明区先填最近前景色，Alpha
作为灰度图单独通过 RIFE v4.6，再重新合成 RGBA。跑步属于循环动画，因此包含
末帧到首帧的回绕插值；每张中间帧按相邻原帧脚底均值做整像素校准。

正式游戏表为 46 帧、8x6、640 格。运行时用 45ms/帧播放，完整循环仍为
2070ms，与插帧前 23 帧、90ms/帧完全一致。

用法：
  E:/.../ComfyUI/.venv/Scripts/python.exe tools/ai-gen/red-werewolf-run-interp.py
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[2]
ASSET = ROOT / "assets" / "enemies" / "red_wolf_king" / "werewolf_running.png"
PREVIEW = ROOT / "tools" / "ai-gen" / "red-werewolf-previews" / "red-werewolf-running.gif"
REPORT_DIR = ROOT / "tools" / "ai-gen" / "_scratch" / "red-werewolf-run-interp-20260823"
SOURCE_BASE = REPORT_DIR / "werewolf_running_23f_source.png"
REPORT = REPORT_DIR / "report.json"
RIFE = (
    ROOT.parent
    / "_tmp"
    / "elise_audit"
    / "rife"
    / "rife-ncnn-vulkan-20221029-windows"
    / "rife-ncnn-vulkan.exe"
)
MODEL = "rife-v4.6"
CELL = 640
SOURCE_COLS = 6
SOURCE_ROWS = 4
SOURCE_COUNT = 23
OUTPUT_COLS = 8
OUTPUT_ROWS = 6
OUTPUT_COUNT = 46
GAME_FRAME_MS = 45


def read_source_cells() -> list[np.ndarray]:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    if not SOURCE_BASE.exists():
        with Image.open(ASSET) as image:
            if image.size != (SOURCE_COLS * CELL, SOURCE_ROWS * CELL):
                raise SystemExit(
                    f"首次运行需要23帧原表，当前尺寸 {image.size}，"
                    f"预期 {(SOURCE_COLS * CELL, SOURCE_ROWS * CELL)}"
                )
        shutil.copy2(ASSET, SOURCE_BASE)

    rgba = np.asarray(Image.open(SOURCE_BASE).convert("RGBA"))
    expected = (SOURCE_ROWS * CELL, SOURCE_COLS * CELL, 4)
    if rgba.shape != expected:
        raise SystemExit(f"23帧原表尺寸 {rgba.shape}，预期 {expected}")
    cells = [
        rgba[(i // SOURCE_COLS) * CELL : (i // SOURCE_COLS + 1) * CELL,
             (i % SOURCE_COLS) * CELL : (i % SOURCE_COLS + 1) * CELL].copy()
        for i in range(SOURCE_COUNT)
    ]
    if any(not (cell[..., 3] > 8).any() for cell in cells):
        raise SystemExit("23帧原表包含空白有效帧，停止插帧")
    return cells


def bleed_rgb(frame: np.ndarray) -> np.ndarray:
    """透明区填最近前景色，防止插值把透明黑带进毛发边缘。"""
    opaque = frame[..., 3] > 8
    if not opaque.any():
        return np.zeros(frame.shape[:2] + (3,), dtype=np.uint8)
    if opaque.all():
        return frame[..., :3].copy()
    _, indices = ndimage.distance_transform_edt(~opaque, return_indices=True)
    return frame[..., :3][indices[0], indices[1]].astype(np.uint8)


def run_rife(first: Path, second: Path, output: Path) -> None:
    subprocess.run(
        [str(RIFE), "-0", str(first), "-1", str(second), "-o", str(output), "-m", MODEL],
        check=True,
        capture_output=True,
        timeout=180,
    )


def alpha_bottom(frame: np.ndarray) -> int | None:
    ys = np.where(frame[..., 3] > 32)[0]
    return int(ys.max()) if ys.size else None


def shift_vertical(frame: np.ndarray, dy: int) -> np.ndarray:
    if dy == 0:
        return frame
    visible = frame[..., 3] > 8
    ys = np.where(visible)[0]
    if not ys.size:
        return frame
    dy = max(-int(ys.min()), min(CELL - 1 - int(ys.max()), dy))
    moved = np.zeros_like(frame)
    if dy > 0:
        moved[dy:] = frame[: CELL - dy]
    elif dy < 0:
        moved[: CELL + dy] = frame[-dy:]
    return moved


def interpolate_pair(first: np.ndarray, second: np.ndarray, pair_dir: Path) -> np.ndarray:
    pair_dir.mkdir(parents=True, exist_ok=True)
    first_rgb = pair_dir / "first_rgb.png"
    second_rgb = pair_dir / "second_rgb.png"
    first_alpha = pair_dir / "first_alpha.png"
    second_alpha = pair_dir / "second_alpha.png"
    middle_rgb = pair_dir / "middle_rgb.png"
    middle_alpha = pair_dir / "middle_alpha.png"
    Image.fromarray(bleed_rgb(first), "RGB").save(first_rgb)
    Image.fromarray(bleed_rgb(second), "RGB").save(second_rgb)
    Image.fromarray(first[..., 3], "L").save(first_alpha)
    Image.fromarray(second[..., 3], "L").save(second_alpha)
    run_rife(first_rgb, second_rgb, middle_rgb)
    run_rife(first_alpha, second_alpha, middle_alpha)
    rgb = np.asarray(Image.open(middle_rgb).convert("RGB")).copy()
    alpha = np.asarray(Image.open(middle_alpha).convert("L")).copy()
    alpha[alpha <= 2] = 0
    rgb[alpha == 0] = 0
    return np.dstack([rgb, alpha])


def build_frames(originals: list[np.ndarray], work_dir: Path) -> tuple[list[np.ndarray], list[int]]:
    frames: list[np.ndarray] = []
    foot_shifts: list[int] = []
    for index, first in enumerate(originals):
        second = originals[(index + 1) % SOURCE_COUNT]
        middle = interpolate_pair(first, second, work_dir / f"pair-{index:02d}")
        current_bottom = alpha_bottom(middle)
        first_bottom = alpha_bottom(first)
        second_bottom = alpha_bottom(second)
        dy = 0
        if current_bottom is not None and first_bottom is not None and second_bottom is not None:
            target = round((first_bottom + second_bottom) / 2)
            dy = target - current_bottom
            middle = shift_vertical(middle, dy)
        frames.extend([first, middle])
        foot_shifts.append(dy)
        print(f"pair {index + 1}/{SOURCE_COUNT}: foot_dy={dy}", flush=True)
    if len(frames) != OUTPUT_COUNT:
        raise SystemExit(f"输出帧数 {len(frames)}，预期 {OUTPUT_COUNT}")
    return frames, foot_shifts


def write_sheet(frames: list[np.ndarray]) -> None:
    sheet = np.zeros((OUTPUT_ROWS * CELL, OUTPUT_COLS * CELL, 4), dtype=np.uint8)
    for index, frame in enumerate(frames):
        row, col = divmod(index, OUTPUT_COLS)
        sheet[row * CELL : (row + 1) * CELL,
              col * CELL : (col + 1) * CELL] = frame
    candidate = REPORT_DIR / "werewolf_running_46f.png"
    Image.fromarray(sheet, "RGBA").save(candidate, compress_level=6)
    shutil.copy2(candidate, ASSET)


def write_preview(frames: list[np.ndarray]) -> None:
    preview_frames = []
    for frame in frames:
        subject = Image.fromarray(frame, "RGBA")
        board = Image.new("RGB", (CELL, CELL), (34, 42, 48))
        board.paste(subject, (0, 0), subject)
        preview_frames.append(board.resize((320, 320), Image.Resampling.LANCZOS))
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    # GIF 以10ms为时间单位；40/50ms交替使46帧总时长精确保持2070ms。
    durations = [40, 50] * SOURCE_COUNT
    preview_frames[0].save(
        PREVIEW,
        save_all=True,
        append_images=preview_frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
    )


def build_report(frames: list[np.ndarray], foot_shifts: list[int]) -> dict:
    alpha_pixels = [int((frame[..., 3] > 0).sum()) for frame in frames]
    bottoms = [alpha_bottom(frame) for frame in frames]
    touching = 0
    transparent_nonblack = 0
    for frame in frames:
        alpha = frame[..., 3]
        edge = np.concatenate(
            [alpha[:4].ravel(), alpha[-4:].ravel(), alpha[:, :4].ravel(), alpha[:, -4:].ravel()]
        )
        touching += int((edge > 12).any())
        transparent = alpha == 0
        transparent_nonblack += int(np.any(frame[..., :3][transparent] != 0, axis=1).sum())
    return {
        "source": str(SOURCE_BASE.relative_to(ROOT)).replace("\\", "/"),
        "source_sha256": hashlib.sha256(SOURCE_BASE.read_bytes()).hexdigest(),
        "output": str(ASSET.relative_to(ROOT)).replace("\\", "/"),
        "source_frames": SOURCE_COUNT,
        "output_frames": len(frames),
        "grid": [OUTPUT_COLS, OUTPUT_ROWS],
        "cell": CELL,
        "game_frame_ms": GAME_FRAME_MS,
        "cycle_ms": len(frames) * GAME_FRAME_MS,
        "loop_seam_interpolated": True,
        "interpolation": "RIFE v4.6 RGB/alpha split with nearest-color bleed",
        "nonempty_frames": sum(value > 0 for value in alpha_pixels),
        "touching_frames": touching,
        "transparent_nonblack_pixels": transparent_nonblack,
        "foot_bottoms": bottoms,
        "intermediate_foot_shifts": foot_shifts,
    }


def main() -> None:
    if not RIFE.exists():
        raise SystemExit(f"RIFE 未找到: {RIFE}")
    originals = read_source_cells()
    with tempfile.TemporaryDirectory(prefix="work-", dir=REPORT_DIR) as temp:
        frames, foot_shifts = build_frames(originals, Path(temp))
    write_sheet(frames)
    write_preview(frames)
    report = build_report(frames, foot_shifts)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"完成：running {SOURCE_COUNT} -> {OUTPUT_COUNT}，循环 {report['cycle_ms']}ms")
    print(f"报告：{REPORT}")


if __name__ == "__main__":
    main()
