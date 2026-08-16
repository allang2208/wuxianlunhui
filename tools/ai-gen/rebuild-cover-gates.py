#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""重建世界-122 铁栅栏门六档资产（2026-08-17）。

用更新后的 `_blockout_specs/cover_gate_<grade>.json`（竖杆 + 每叶上下两条
水平 rail）重渲 16 帧 → `compose-cover-gate.py` 合成 4×4 全门图 →
`split-cover-gate-layers.py` 拆柱/栅栏层并清理柱外残留。

用法：
    python tools/ai-gen/rebuild-cover-gates.py [--grades FEDCBA] [--keep-frames]

依赖：
    - Blender 5.1（默认 E:/Program Files/Blender Foundation/Blender 5.1/blender.exe）
    - Y:/工作/无尽轮回/scratch/world122/raw 下的六档墙砖纹理
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools"
AI_TOOLS = ROOT / "tools" / "ai-gen"
ASSETS = ROOT / "assets" / "terrain"
DEFAULT_BLENDER = "E:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
DEFAULT_SCRATCH = Path("Y:/工作/无尽轮回/scratch/world122")
FRAMES = 16


def run(cmd: list[str], **kwargs) -> None:
    print(">", " ".join(str(c) for c in cmd))
    subprocess.run(cmd, cwd=ROOT, check=True, **kwargs)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grades", default="FEDCBA")
    ap.add_argument("--blender", default=os.environ.get("GATE_BLENDER", DEFAULT_BLENDER))
    ap.add_argument("--scratch", default=os.environ.get("GATE_SCRATCH", str(DEFAULT_SCRATCH)))
    ap.add_argument("--keep-frames", action="store_true")
    ap.add_argument("--skip-cleanup", action="store_true")
    args = ap.parse_args()

    scratch = Path(args.scratch)
    blender = Path(args.blender)
    render_script = AI_TOOLS / "render-cover-gate.py"
    compose_script = AI_TOOLS / "compose-cover-gate.py"
    split_script = AI_TOOLS / "split-cover-gate-layers.py"
    # 2026-08-17：旧资产时代的一次性残柱剔除脚本（remove-gate-stray-cylinder /
    # remove-gate-wall-steel-column / remove-gate-pillar-steel-column）不纳入重渲
    # 流程——它们按旧贴图的固定区域/连通域大小删像素，新渲染没有那些烘焙残块，
    # 反而可能误删滑出门洞半途的栅栏叶碎片。柱外/柱内残留由 split 内置清理 +
    # clean-gate-bars-outside-pillars（柱框裁剪，幂等）兜底。
    clean_bars_script = TOOLS / "clean-gate-bars-outside-pillars.py"

    if not blender.exists():
        print(f"[error] Blender 不存在: {blender}")
        return 2
    if not scratch.exists():
        print(f"[error] scratch 根目录不存在: {scratch}（纹理/输出目录）")
        return 2

    grades = [g.upper() for g in args.grades if g.upper() in "FEDCBA"]
    for grade in grades:
        spec = AI_TOOLS / "_blockout_specs" / f"cover_gate_{grade.lower()}.json"
        frames_dir = scratch / f"gate_{grade.lower()}"
        frames_dir.mkdir(parents=True, exist_ok=True)

        # 1) Blender 逐帧渲染（slide=0 关闭 → slide=1 全开）
        for n in range(FRAMES):
            frame_path = frames_dir / f"frame_{n:02d}.png"
            run([
                str(blender), "--background", "--factory-startup",
                "--python", str(render_script), "--",
                str(spec), str(frame_path), "--slide", f"{n / (FRAMES - 1):.12f}",
            ])

        # 2) 以关闭帧内容框裁剪并合成 4×4 spritesheet
        dst = ASSETS / f"cover_gate_{grade}.png"
        run([sys.executable, str(compose_script), grade, str(frames_dir), str(dst)])

        # 3) 拆左右柱静态图 + 栅栏/横杆 16 帧图；split 内置柱外残留清理
        run([sys.executable, str(split_script), grade])

        if not args.keep_frames:
            # 保留原始帧会占大量空间，默认清理
            for p in frames_dir.glob("frame_*.png"):
                p.unlink(missing_ok=True)

    if not args.skip_cleanup:
        # 4) bars 柱内/柱外残留兜底清理（幂等；split 已内置同款清理）
        for script in (clean_bars_script,):
            if script.exists():
                run([sys.executable, str(script)])


    print("全部完成。刷新 Vite 页面（Ctrl+F5）后检查世界-122 基地门。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
