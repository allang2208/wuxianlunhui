#!/usr/bin/env python3
"""世界-122 防守地图素材批量生图（2026-08-04）。

模型：FLUX.2 Klein 4B 无 LoRA（默认自由构图入口）。
产出：Y:\\工作\\无尽轮回\\scratch\\world122\\raw\\*.png（白底原图，后续 prep-obstacle 抠图入库）。

用法：
    python tools/ai-gen/gen-world122-assets.py            # 全量（12 掩体 + 2 塔）
    python tools/ai-gen/gen-world122-assets.py --keys cover_F_h tower_A   # 指定条目
"""
import argparse
import os
import subprocess
import sys
import time

from prompt_principles import STYLE_BASELINE

DIR = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(DIR, "comfyui-gen.py")
HOST = "192.168.3.142"
MODEL = "flux2-klein-4b-nolora"
OUT_DIR = r"Y:\工作\无尽轮回\scratch\world122\raw"

STYLE = STYLE_BASELINE

VIEW_H = (
    "low defensive cover wall, game isometric asset, the cover stands on a floor line "
    "tilted 30 degrees, long axis running from upper-left to lower-right, "
    "bottom edge aligned at exactly 30 degrees to the horizontal (slope down to the right), "
    "front face visible, top surface slightly visible and foreshortened"
)

VIEW_V = (
    "low defensive cover wall, game isometric asset, the cover stands on a floor line "
    "tilted 30 degrees, long axis running from upper-right to lower-left, "
    "bottom edge aligned at exactly 30 degrees to the horizontal (slope down to the left), "
    "front face visible, top surface slightly visible and foreshortened"
)

THEME = {
    "F": "simple wooden plank cover wall, reinforced timber planks with wooden braces, weathered pale wood",
    "E": "sandbag and timber cover wall, stacked sand-filled canvas sandbags with a wooden frame",
    "D": "stone rubble cover wall, stacked rough stones and boulders, mossy joints",
    "C": "masonry brick and concrete cover wall, reinforced fortification blocks with steel corner plates",
    "B": "steel armored cover wall, dark riveted metal armor plates with a horizontal firing slit",
    "A": "dark runed metal cover wall, black steel plates with faint glowing energy runes, advanced magical fortification",
}

NEG = (
    "blurry, low quality, watermark, text, signature, gradient background, gray background, "
    "dark background, vignette, frame, border, people, hands, grass, floor texture, "
    "shadows, drop shadow, cast shadow, hard lighting, directional light, rim light, "
    "multiple covers, lineup, duplicate objects, top-down view"
)


def cover_items():
    # 2026-08-05 实测：模型不区分 h/v 斜向，raw 恒为 "/"；h 由 raw 镜像派生（见
    # process-world122 与 prompts/cover.md "一图两向"），v 用 raw 原样。
    items = []
    seed = 1001
    for grade in ["F", "E", "D", "C", "B", "A"]:
        for orient, view in (("h", VIEW_H), ("v", VIEW_V)):
            prompt = f"{THEME[grade]}, {view}, {STYLE}"
            items.append({
                "key": f"cover_{grade}_{orient}",
                "prompt": prompt,
                "negative": NEG,
                "seed": seed,
                "out": os.path.join(OUT_DIR, f"cover_{grade}_{orient}.png"),
            })
            seed += 7
    return items


def tower_items():
    base = (
        "game asset building, photorealistic 3D render, "
        "a compact defense tower: sturdy dark stone and metal base at the bottom, "
        "and a mechanical robotic arm hanging from the top front, with an empty weapon "
        "mounting rail at the arm tip, a clean empty circular flange socket with no gun, "
        "riveted metal joints, worn paint, modular weapon socket ready to hold a gun, "
        "frontal view, straight-on, slight three-quarter perspective, facing the camera, "
        "base sitting flat on the ground, flat bottom edge, no visible top surface, "
        "the whole tower fully visible with generous margin, "
        "dark realistic materials, flat diffuse ambient lighting, no light source, "
        "no shadows, no drop shadow, "
        "centered composition, isolated on plain pure white background, high detail, "
        "no text, no watermark"
    )
    neg = (
        "blurry, low quality, watermark, text, signature, gradient background, gray background, "
        "dark background, vignette, frame, border, people, hands, drop shadow, cast shadow, "
        "hard lighting, directional light, gun, weapon mounted, "
        "multiple towers, duplicate objects, top-down view, UI element, "
        "gun barrel, cannon, rifle, machine gun, pistol, weapon attached, weapon on the arm"
    )
    return [
        {"key": "defense_tower_A", "prompt": base, "negative": neg, "seed": 2001,
         "out": os.path.join(OUT_DIR, "defense_tower_A.png")},
        {"key": "defense_tower_B", "prompt": base.replace(
            "sturdy dark stone and metal base",
            "heavy riveted metal turret base with a wide circular footing"), "negative": neg,
         "seed": 2002, "out": os.path.join(OUT_DIR, "defense_tower_B.png")},
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", nargs="*", default=None, help="只跑指定 key（如 cover_F_h defense_tower_A）")
    ap.add_argument("--timeout", type=int, default=900)
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    items = cover_items() + tower_items()
    if args.keys:
        wanted = set(args.keys)
        items = [it for it in items if it["key"] in wanted]

    print(f"[world122] 共 {len(items)} 张，模型 {MODEL}@{HOST}，输出 {OUT_DIR}", flush=True)
    failed = []
    for i, it in enumerate(items, 1):
        print(f"[{i}/{len(items)}] {it['key']} seed={it['seed']} ...", flush=True)
        prompt_file = os.path.join(OUT_DIR, f"_prompt_{it['key']}.txt")
        with open(prompt_file, "w", encoding="utf-8") as fh:
            fh.write(it["prompt"])
        cmd = [
            sys.executable, GEN,
            "--host", HOST, "--model", MODEL,
            "--prompt-file", prompt_file,
            "--negative", it["negative"],
            "--seed", str(it["seed"]),
            "--out", it["out"],
            "--timeout", str(args.timeout),
        ]
        t0 = time.time()
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=args.timeout + 120)
        except subprocess.TimeoutExpired:
            print(f"    FAIL 生图子进程超时（{args.timeout + 120}s）", flush=True)
            failed.append(it["key"])
            if os.path.exists(prompt_file):
                os.remove(prompt_file)
            continue
        cost = time.time() - t0
        if r.returncode == 0 and os.path.exists(it["out"]):
            print(f"    OK {cost:.0f}s -> {it['out']}", flush=True)
        else:
            print(f"    FAIL {cost:.0f}s rc={r.returncode}", flush=True)
            print((r.stdout or "")[-1200:], flush=True)
            print((r.stderr or "")[-1200:], flush=True)
            failed.append(it["key"])
        if os.path.exists(prompt_file):
            os.remove(prompt_file)

    print(f"\n[world122] 完成：成功 {len(items) - len(failed)}，失败 {len(failed)}", flush=True)
    if failed:
        print("失败条目: " + ", ".join(failed), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
