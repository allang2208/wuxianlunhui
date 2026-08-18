#!/usr/bin/env python3
"""地面无缝纹理统一入口（2026-08-16 定稿，平材质地面默认管线）

流程（一条命令走完）：
  comfyui-gen（无缝方形图，低饱和提示词）→ make-seamless（偏移叠融四边环绕）
  → desaturate-texture（降饱和提亮）→ 输出到 assets/terrain/

产出直接供连续铺贴地板使用：
  scene-manager 世界-122 配置 = { tiles:[<键>], continuous:true, textureScaleY:0.5774,
  sandPatches:{...}, deco:{...} }；贴图键在 BootScene 注册 <文件名去扩展名>。

用法（相对 game-dev/ 根目录）：
  python tools/ai-gen/floor-asset.py mud   --out assets/terrain/floor_mud_seamless.png  --seed 9001
  python tools/ai-gen/floor-asset.py sand  --out assets/terrain/floor_sand_seamless.png --seed 9101 --desat 0.5
  # 可选：--no-desat 跳过降饱和；--host/--model 覆盖生图入口
"""
import argparse
import os
import subprocess
import sys

DIR = os.path.dirname(os.path.abspath(__file__))

PROMPT = {
    "mud": os.path.join(DIR, "prompts", "floor-seamless-mud.txt"),
    "sand": os.path.join(DIR, "prompts", "floor-seamless-sand.txt"),
    "snow-fresh": os.path.join(DIR, "prompts", "floor-seamless-snow-fresh.txt"),
    "snow-packed": os.path.join(DIR, "prompts", "floor-seamless-snow-packed.txt"),
    "snow-wind": os.path.join(DIR, "prompts", "floor-seamless-snow-wind.txt"),
    "grass-forest": os.path.join(DIR, "prompts", "floor-seamless-grass-forest.txt"),
}
DESAT_DEFAULT = {
    "mud": 0.55,
    "sand": 0.5,
    "snow-fresh": 0.18,
    "snow-packed": 0.28,
    "snow-wind": 0.35,
    "grass-forest": 0.42,
}


def run(*args):
    print("+", " ".join(args), flush=True)
    subprocess.check_call(args)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=sorted(PROMPT), help="地面材质")
    ap.add_argument("--out", required=True, help="输出 PNG（assets/terrain/...）")
    ap.add_argument("--seed", type=int, default=9001)
    ap.add_argument("--host", default="192.168.3.142")
    ap.add_argument("--model", default="flux2-dev-fp8")
    ap.add_argument("--size", default="1024x1024")
    ap.add_argument("--desat", type=float, default=None,
                    help="降饱和比例（默认 mud 0.55 / sand 0.5；--no-desat 跳过）")
    ap.add_argument("--no-desat", action="store_true")
    args = ap.parse_args()

    raw = os.path.join(os.path.dirname(args.out), f"_raw_{args.kind}_{args.seed}.png")
    run(sys.executable, os.path.join(DIR, "comfyui-gen.py"),
        "--host", args.host, "--model", args.model,
        "--prompt-file", PROMPT[args.kind], "--size", args.size,
        "--seed", str(args.seed), "--out", raw)
    run(sys.executable, os.path.join(DIR, "make-seamless.py"), raw, args.out)
    if not args.no_desat:
        desat = args.desat if args.desat is not None else DESAT_DEFAULT[args.kind]
        run(sys.executable, os.path.join(DIR, "desaturate-texture.py"),
            args.out, args.out, "--amount", str(desat), "--lighten", "1.05")
    os.remove(raw)
    print(f"OK: {args.out}（连续铺贴纹理，30° 等距压缩在渲染侧完成）")


main()
