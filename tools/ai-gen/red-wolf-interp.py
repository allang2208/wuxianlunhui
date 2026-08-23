#!/usr/bin/env python3
"""红狼王一次性攻击动作 RIFE 插帧（attack 12 -> 21 / pounce 12 -> 23）。

只在相邻原帧之间生成一个中间帧，不做末帧到首帧的回绕插值。RGB 透明区先用
最近前景色填充，Alpha 作为灰度图单独通过 RIFE v4.6，再重新合成 RGBA；中间帧
脚底按相邻原帧底边均值做整像素校准，避免 Alpha 软化造成上下跳动。

attack 在完整插帧后移除慢速闭嘴段的两帧，只保留 1 张咬合中间帧和 1 张闭嘴帧；
运行时长保持不变，末帧闭嘴姿态停留到 1.2 秒结束。pounce 的 900ms 蓄力和
900ms 冲锋不变。脚本不保存旧运行时资产，只输出复核 GIF 与量化报告。

用法：
  E:/.../ComfyUI/.venv/Scripts/python.exe tools/ai-gen/red-wolf-interp.py
"""

from __future__ import annotations

import json
import hashlib
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[2]
ASSET_DIR = ROOT / "assets" / "enemies" / "red_wolf_king"
MASTER_DIR = ROOT / "tools" / "ai-gen" / "_scratch" / "red-wolf-master-anim-20260822" / "sheets"
SOURCE_SHEETS = {
    "attack": MASTER_DIR / "red_wolf_king_pounce_bite.png",
    "pounce": MASTER_DIR / "red_wolf_king_pounce_claw.png",
}
REPORT_DIR = ROOT / "tools" / "ai-gen" / "_scratch" / "red-wolf-interp-20260823"
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
SOURCE_COLS = 4
SOURCE_ROWS = 3
SOURCE_COUNT = 12
OUTPUT_COLS = 5
OUTPUT_ROWS = 5
OUTPUT_COUNTS = {"attack": 21, "pounce": 23}


def extract_cells(path: Path) -> list[np.ndarray]:
    rgba = np.asarray(Image.open(path).convert("RGBA"))
    expected = (SOURCE_ROWS * CELL, SOURCE_COLS * CELL, 4)
    if rgba.shape != expected:
        raise SystemExit(f"{path.name}: 尺寸 {rgba.shape}，预期 {expected}")
    return [
        rgba[(i // SOURCE_COLS) * CELL : (i // SOURCE_COLS + 1) * CELL,
             (i % SOURCE_COLS) * CELL : (i % SOURCE_COLS + 1) * CELL].copy()
        for i in range(SOURCE_COUNT)
    ]


def bleed_rgb(frame: np.ndarray) -> np.ndarray:
    """透明区填最近前景色，防止 RIFE 插值把透明黑带进毛发边缘。"""
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
    else:
        moved = frame
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


def interpolate_action(name: str, work_dir: Path) -> tuple[list[np.ndarray], list[int]]:
    source = SOURCE_SHEETS[name]
    if not source.exists():
        raise SystemExit(f"{name}: 12帧母版不存在: {source}")
    originals = extract_cells(source)
    frames: list[np.ndarray] = []
    foot_shifts: list[int] = []
    for index in range(SOURCE_COUNT - 1):
        first = originals[index]
        second = originals[index + 1]
        middle = interpolate_pair(first, second, work_dir / name / f"pair-{index:02d}")
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
        print(f"[{name}] pair {index + 1}/{SOURCE_COUNT - 1}: foot_dy={dy}", flush=True)
    frames.append(originals[-1])
    if name == "attack":
        # 完整 23 帧中的 18=最后一张全张嘴，19=慢闭中间帧，20=慢闭原帧，
        # 21=快速咬合中间帧，22=完全闭嘴。删 19/20，让闭合只占最终两帧。
        frames = frames[:19] + frames[21:]
        foot_shifts = foot_shifts[:9] + foot_shifts[10:]
    return frames, foot_shifts


def write_sheet(name: str, frames: list[np.ndarray]) -> None:
    expected = OUTPUT_COUNTS[name]
    if len(frames) != expected:
        raise SystemExit(f"{name}: 输出帧数 {len(frames)}，预期 {expected}")
    sheet = np.zeros((OUTPUT_ROWS * CELL, OUTPUT_COLS * CELL, 4), dtype=np.uint8)
    for index, frame in enumerate(frames):
        row, col = divmod(index, OUTPUT_COLS)
        sheet[row * CELL : (row + 1) * CELL, col * CELL : (col + 1) * CELL] = frame
    candidate = REPORT_DIR / f"{name}_23f.png"
    Image.fromarray(sheet, "RGBA").save(candidate, compress_level=6)
    candidate.replace(ASSET_DIR / f"{name}.png")


def checkerboard(size: int = CELL, tile: int = 32) -> Image.Image:
    image = Image.new("RGB", (size, size), (45, 48, 55))
    draw = ImageDraw.Draw(image)
    for y in range(0, size, tile):
        for x in range(0, size, tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill=(64, 68, 77))
    return image


def write_preview(name: str, frames: list[np.ndarray]) -> None:
    preview_frames = []
    for frame in frames:
        subject = Image.fromarray(frame, "RGBA")
        board = checkerboard()
        board.paste(subject, (0, 0), subject)
        preview_frames.append(board.resize((320, 320), Image.Resampling.LANCZOS))
    if name == "attack":
        durations = [50] * 20 + [200]
    else:
        durations = [112] * 8 + [60] * 15
    preview_frames[0].save(
        REPORT_DIR / f"{name}_{len(frames)}f_preview.gif",
        save_all=True,
        append_images=preview_frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
    )


def metrics(name: str, frames: list[np.ndarray], foot_shifts: list[int]) -> dict:
    source = SOURCE_SHEETS[name]
    alpha_pixels = [int((frame[..., 3] > 0).sum()) for frame in frames]
    bottoms = [alpha_bottom(frame) for frame in frames]
    transparent_rgb = sum(
        int(np.any(frame[..., :3][frame[..., 3] == 0] != 0, axis=1).sum()) for frame in frames
    )
    return {
        "source_sheet": str(source.relative_to(ROOT)).replace("\\", "/"),
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "source_frames": SOURCE_COUNT,
        "output_frames": len(frames),
        "cell": CELL,
        "grid": [OUTPUT_COLS, OUTPUT_ROWS],
        "nonempty_frames": sum(value > 0 for value in alpha_pixels),
        "alpha_pixels_min": min(alpha_pixels),
        "alpha_pixels_max": max(alpha_pixels),
        "foot_bottoms": bottoms,
        "intermediate_foot_shifts": foot_shifts,
        "transparent_nonblack_pixels": transparent_rgb,
        "interpolation": "RIFE v4.6 RGB/alpha split, adjacent pairs only, no loop seam",
    }


def main() -> None:
    if not RIFE.exists():
        raise SystemExit(f"RIFE 未找到: {RIFE}")
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {}
    with tempfile.TemporaryDirectory(prefix="work-", dir=REPORT_DIR) as temp:
        work_dir = Path(temp)
        for name in ("attack", "pounce"):
            frames, foot_shifts = interpolate_action(name, work_dir)
            write_sheet(name, frames)
            write_preview(name, frames)
            report[name] = metrics(name, frames, foot_shifts)
    (REPORT_DIR / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"完成：attack 12 -> 21 / pounce 12 -> 23，报告 {REPORT_DIR / 'report.json'}")


if __name__ == "__main__":
    main()
