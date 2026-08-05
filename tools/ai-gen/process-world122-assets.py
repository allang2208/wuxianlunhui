#!/usr/bin/env python3
"""世界-122 掩体/防御塔素材后处理：镜像归一 + 抠图入库（2026-08-04）。

像素检测结论：FLUX.2 未区分 h/v 斜向（全部产出 "/" 上右斜）。
处理规则：
- 掩体 _h（水平摆）→ 水平镜像为 "\\"（与游戏未翻转墙一致）；
- 掩体 _v（垂直摆）→ 原样；
- 防御塔 → 原样。
抠图：prep-obstacle.py（GrabCut + 最大连通域 + 去污染 + 包围盒裁剪）。
入库：game-dev/assets/terrain/obstacle_cover_<grade>_<orient>.png /
       obstacle_defense_tower.png。

用法：python tools/ai-gen/process-world122-assets.py [--dry-run]
"""
import argparse
import os
import shutil
import subprocess
import sys

from PIL import Image

DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(DIR))  # game-dev
RAW = r"Y:\工作\无尽轮回\scratch\world122\raw"
ASSETS = os.path.join(ROOT, "assets", "terrain")
PREP = os.path.join(DIR, "prep-obstacle.py")
COMFY_VENV_PY = os.path.join(os.path.dirname(ROOT), "ComfyUI", ".venv", "Scripts", "python.exe")


def cover_targets():
    out = []
    for grade in ["F", "E", "D", "C", "B", "A"]:
        for orient in ["h", "v"]:
            raw = os.path.join(RAW, f"cover_{grade}_{orient}.png")
            dst = os.path.join(ASSETS, f"obstacle_cover_{grade}_{orient}.png")
            out.append((raw, dst, orient))
    return out


def tower_targets():
    return [
        (os.path.join(RAW, "defense_tower_A.png"), os.path.join(ASSETS, "obstacle_defense_tower.png"), "tower"),
        (os.path.join(RAW, "defense_tower_B.png"), os.path.join(ASSETS, "obstacle_defense_tower_B.png"), "tower"),
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--keys", nargs="*", default=None)
    ap.add_argument("--python", default=None, help="运行 prep-obstacle 的 Python（默认 ComfyUI venv）")
    args = ap.parse_args()

    os.makedirs(ASSETS, exist_ok=True)
    tmp = os.path.join(RAW, "_tmp")
    os.makedirs(tmp, exist_ok=True)
    prep_py = args.python or (COMFY_VENV_PY if os.path.exists(COMFY_VENV_PY) else sys.executable)

    targets = cover_targets() + tower_targets()
    if args.keys:
        wanted = set(args.keys)
        targets = [t for t in targets if any(k in os.path.basename(t[0]) for k in wanted)]

    for raw, dst, orient in targets:
        if not os.path.exists(raw):
            print(f"SKIP missing {raw}")
            continue
        name = os.path.basename(dst)
        print(f"== {name} ==", flush=True)
        src = raw
        if orient == "h":
            mirrored = os.path.join(tmp, name.replace(".png", "_mir.png"))
            Image.open(raw).transpose(Image.FLIP_LEFT_RIGHT).save(mirrored)
            src = mirrored
            print(f"   mirrored h -> {os.path.basename(mirrored)}", flush=True)
        if args.dry_run:
            print(f"   [dry-run] would prep {src} -> {dst}")
            continue
        if os.path.exists(dst):
            shutil.copy2(dst, dst + ".bak")
            print(f"   已备份旧文件 -> {os.path.basename(dst)}.bak", flush=True)
        try:
            r = subprocess.run(
                [prep_py, PREP, src, dst],
                capture_output=True, text=True, timeout=300,
            )
        except subprocess.TimeoutExpired:
            print(f"   FAIL 抠图子进程超时（300s）: {name}", file=sys.stderr, flush=True)
            continue
        print((r.stdout or "").strip(), flush=True)
        if r.returncode != 0:
            print((r.stderr or "").strip(), file=sys.stderr, flush=True)
        else:
            print(f"   SAVED {dst}", flush=True)

    shutil.rmtree(tmp, ignore_errors=True)
    print("\n[done]")


if __name__ == "__main__":
    main()
