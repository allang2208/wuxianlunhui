#!/usr/bin/env python3
"""attack_sword 单手反手回击 H3 批跑器。

必须用 ComfyUI venv python 运行：
  E:\\无尽轮回\\长期备份\\2026-7-13-1\\ComfyUI\\.venv\\Scripts\\python.exe ^
      run-player-attack-sword.py --dry-run
  E:\\无尽轮回\\长期备份\\2026-7-13-1\\ComfyUI\\.venv\\Scripts\\python.exe ^
      run-player-attack-sword.py --seeds 1,2,3,4

流程：
  1. 三张原图 BiRefNet 抠图 -> 对齐 -> 纯色底合成关键帧（A/B/C）；
  2. A->B 和 B->C 两段 H3 首尾帧生成；
  3. 输出 MP4 到 out-root/h3/，便于下一步抽帧拼接 attack_sword 12 帧。

提示：H3 每段约 6-8 分钟，建议先 --seeds 1,2 粗筛，再追加种子。
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
PREP_SCRIPT = TOOLS_DIR / "prep-player-attack-keyframes.py"
H3_SCRIPT = TOOLS_DIR / "minimax-h3-gen.py"
PROMPT_AB = TOOLS_DIR / "prompts" / "player-attack-sword-ab.txt"
PROMPT_BC = TOOLS_DIR / "prompts" / "player-attack-sword-bc.txt"

DEFAULT_SRC = r"E:\无尽轮回\游戏\素材库\人物\主角动画\1"
DEFAULT_OUT = r"Y:\工作\无尽轮回\scratch\player_attack_sword"


def run(cmd, dry_run):
    print(">>>", " ".join(str(x) for x in cmd), flush=True)
    if dry_run:
        return
    subprocess.check_call([str(x) for x in cmd])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src-dir", default=DEFAULT_SRC)
    ap.add_argument("--out-root", default=DEFAULT_OUT)
    ap.add_argument("--order", default="1,2,3",
                    help="三张原图对应的 A起手,B命中,C收势 顺序")
    ap.add_argument("--seeds", default="1,2,3,4,5,6,7,8")
    ap.add_argument("--segments", default="ab,bc")
    ap.add_argument("--steps", type=int, default=16)
    ap.add_argument("--duration", type=float, default=5.17)
    ap.add_argument("--size", default="1024x576")
    ap.add_argument("--host", default="192.168.3.142")
    ap.add_argument("--port", type=int, default=8188)
    ap.add_argument("--skip-prep", action="store_true")
    ap.add_argument("--skip-existing", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    out_root = Path(args.out_root)
    key_dir = out_root / "keyframes"
    h3_dir = out_root / "h3"
    if not args.skip_prep:
        key_dir.mkdir(parents=True, exist_ok=True)
        prep_cmd = [
            sys.executable, str(PREP_SCRIPT),
            "--src-dir", args.src_dir,
            "--out-dir", str(key_dir),
            "--width", str(int(args.size.split("x")[0])),
            "--height", str(int(args.size.split("x")[1])),
            "--order", args.order,
        ]
        run(prep_cmd, args.dry_run)

    bg_file = key_dir / "bg.txt"
    if args.dry_run:
        bg_hex = "FFFFFF"
    else:
        if not bg_file.exists():
            ap.error(f"missing {bg_file}; run prep first (or remove --skip-prep)")
        bg_hex = bg_file.read_text(encoding="ascii").strip()

    frames = {
        "A": key_dir / "A_start_flat.png",
        "B": key_dir / "B_hit_flat.png",
        "C": key_dir / "C_recover_flat.png",
    }
    if not args.dry_run:
        for label, p in frames.items():
            if not p.exists():
                ap.error(f"missing keyframe {label}: {p}")

    seeds = [int(x) for x in args.seeds.split(",") if str(x).strip()]
    segments = [s.strip().lower() for s in args.segments.split(",") if s.strip()]

    seg_cfg = {
        "ab": (frames["A"], frames["B"], PROMPT_AB),
        "bc": (frames["B"], frames["C"], PROMPT_BC),
    }

    h3_dir.mkdir(parents=True, exist_ok=True)
    for seg in segments:
        if seg not in seg_cfg:
            ap.error(f"bad segment {seg!r}; expect ab/bc")
        first, last, prompt_file = seg_cfg[seg]
        for seed in seeds:
            out_mp4 = h3_dir / f"attack_sword_{seg}_s{seed:02d}.mp4"
            if args.skip_existing and out_mp4.exists() and out_mp4.stat().st_size > 100_000:
                print(f"[skip] {out_mp4} exists", flush=True)
                continue
            cmd = [
                sys.executable, str(H3_SCRIPT),
                "--first-frame", str(first),
                "--last-frame", str(last),
                "--prompt-file", str(prompt_file),
                "--duration", str(args.duration),
                "--size", args.size,
                "--steps", str(args.steps),
                "--seed", str(seed),
                "--bg-color", f"#{bg_hex}",
                "--host", args.host,
                "--port", str(args.port),
                "--out", str(out_mp4),
                "--prefix", "video/player_attack_sword",
            ]
            run(cmd, args.dry_run)
    print("[player-attack-sword] DONE", flush=True)


if __name__ == "__main__":
    main()
