#!/usr/bin/env python3
"""世界-122 能源水晶 v3 批量生图调度器（2026-08-16）。

思路：
  1. 程序化绘制 12 张深度控制图——每张一种独立形态（单柱/双生/三冠/团簇/扇簇/尖塔/
     碎晶/环晶/晶脊/斜晶/对裂/野晶），底座统一画成 30° 菱形土堆接地线；
  2. 每张深度图分别走 FLUX.2 dev + Depth ControlNet + --transparent：
     normal 12 张 + depleted 12 张（同深度图，只换枯竭态提示词）；
  3. 出图在 Y:\\工作\\无尽轮回\\scratch\\energy-node-v3\\raw\\，--install 时复制到
     assets/terrain/energy_node_v3_<n>.png / energy_node_depleted_v3_<n>.png。

用法：
    python tools/ai-gen/gen-energy-node-v3.py --limit 1 --depth-only
    python tools/ai-gen/gen-energy-node-v3.py --limit 1 --no-refine --host 192.168.3.142
    python tools/ai-gen/gen-energy-node-v3.py --resume --install
"""
import argparse
import math
import os
import random
import shutil
import subprocess
import sys

try:
    import numpy as np
    from PIL import Image, ImageDraw
except Exception:
    print("需要 Pillow + numpy：请使用 ComfyUI venv 或 pip install pillow numpy", file=sys.stderr)
    sys.exit(1)

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(TOOLS_DIR))
GEN = os.path.join(TOOLS_DIR, "comfyui-gen.py")
SCRATCH = r"Y:\工作\无尽轮回\scratch\energy-node-v3"
DEPTH_DIR = os.path.join(SCRATCH, "depth")
RAW_DIR = os.path.join(SCRATCH, "raw")
PROMPT_DIR = os.path.join(SCRATCH, "prompts")
ASSET_DIR = os.path.join(REPO_ROOT, "assets", "terrain")

FLOOR_SLOPE = math.tan(math.radians(30))  # 0.5774，与 wall-system 对齐
SIZE = 1024
BOTTOM_Y = 920

# 形态与 seed 必须和 src/world/energy-node-textures.js FORMS 一一对应
FORMS = [
    ("single_spire", 1101, "one single tall blue crystal spire with two tiny shards at its base"),
    ("twin_spires", 1202, "two tall blue crystal spires crossing each other, one leans left and one leans right"),
    ("triple_crown", 1303, "three large blue crystals in a crown arrangement, center taller than both sides"),
    ("dense_cluster", 1404, "a dense cluster of nine blue crystal shards packed tightly together with varied heights"),
    ("fan_cluster", 1505, "seven thin blue crystal blades fanning out from one base, center blade tallest"),
    ("needle_spire", 1606, "one extremely tall narrow needle-like blue crystal with four tiny base shards"),
    ("broken_shard", 1707, "one large broken blue crystal with a snapped top and scattered small shards around its base"),
    ("ring_cluster", 1808, "a ring of nine small blue crystals around a dark hollow center"),
    ("crystal_crest", 1909, "a long low crest of blue crystals like a crystal spine, six main shards with center highest"),
    ("leaning_spire", 2010, "one tall blue crystal leaning strongly to the right with short supporting shards on the left"),
    ("split_geode", 2111, "two half-geode blue crystal bodies split apart with inner facets facing each other"),
    ("wild_growth", 2212, "a wild growth of thirteen irregular blue crystals pointing in many directions with no symmetry"),
]

MATERIAL = (
    "faceted azure and cyan crystal planes, sharp facet edges, bright specular highlights "
    "on facet ridges, inner light refraction and translucency, glowing deep blue core, "
    "fine crystalline fracture lines, tiny blue crystal chips embedded in the soil mound"
)
VIEW_GROUND = (
    "front-facing game sprite, low camera angle around 8 to 15 degrees, the crystal cluster "
    "grows from a low dark soil mound, the mound base contacts the ground with a shallow "
    "isometric diamond footprint, the left and right bottom edges of the mound are straight "
    "lines tilted exactly 30 degrees to the horizontal and meet at the front center point, "
    "contact shadow baked only into the mound base, transparent background outside the sprite"
)
STYLE = (
    "game asset prop, photorealistic 3D render, dark realistic materials, flat diffuse ambient "
    "lighting, no light source, no cast shadow on background, isolated on plain pure solid color "
    "background, high detail, no text, no watermark"
)
AVOID = (
    "no flat cut bottom, no horizontal bottom edge, no floating crystals, no background props, "
    "no multiple separate clusters, no symmetric copy-paste layout, no cartoon style, no cell shading"
)


def prompt_for(theme, depleted=False):
    theme = theme if not depleted else (
        "depleted gray crystal cluster, drained of energy, dark matte gray-blue facets, "
        "cracked dull surfaces, no glow, no inner light, dead soil mound"
    )
    return f"{theme}, {MATERIAL}, {VIEW_GROUND}, {STYLE}, {AVOID}"


def make_shards(form_key, seed):
    rnd = random.Random(seed)
    cx = 0.0
    out = []
    jitter = lambda v: (rnd.random() - 0.5) * v  # noqa: E731

    def add(x, h, bw, lean=0.0):
        out.append((x, h, bw, lean))

    if form_key == "single_spire":
        add(cx, 0.34, 0.11, 0.0)
        add(cx - 0.085, 0.12, 0.055, -0.01)
        add(cx + 0.09, 0.14, 0.06, 0.01)
        add(cx + 0.02, 0.18, 0.05, 0.02)
    elif form_key == "twin_spires":
        add(cx - 0.07, 0.30, 0.10, -0.05)
        add(cx + 0.075, 0.32, 0.105, 0.055)
        add(cx - 0.14, 0.14, 0.055, -0.01)
        add(cx + 0.15, 0.13, 0.055, 0.01)
        add(cx, 0.16, 0.045, 0.0)
    elif form_key == "triple_crown":
        add(cx, 0.34, 0.11, 0.0)
        add(cx - 0.14, 0.24, 0.075, -0.025)
        add(cx + 0.14, 0.25, 0.075, 0.025)
        add(cx - 0.215, 0.12, 0.05, -0.015)
        add(cx + 0.215, 0.125, 0.05, 0.015)
    elif form_key == "dense_cluster":
        for i in range(10):
            u = (i / 9 - 0.5) * 2
            hh = 0.13 + rnd.random() * 0.22 + (1 - abs(u)) * 0.10
            add(cx + u * 0.32 + jitter(0.035), hh, 0.05 + rnd.random() * 0.04, u * 0.05)
    elif form_key == "fan_cluster":
        for i in range(-3, 4):
            spread = abs(i) / 3.0
            add(cx + i * 0.095, 0.15 + (1 - spread) * 0.18 + jitter(0.02),
                0.045 + (1 - spread) * 0.025, i * 0.045)
        add(cx, 0.30, 0.085, 0.0)
    elif form_key == "needle_spire":
        add(cx, 0.44, 0.075, 0.0)
        add(cx - 0.075, 0.17, 0.04, -0.02)
        add(cx + 0.08, 0.16, 0.04, 0.02)
        add(cx - 0.035, 0.10, 0.035, -0.01)
        add(cx + 0.04, 0.09, 0.035, 0.01)
    elif form_key == "broken_shard":
        add(cx - 0.04, 0.30, 0.12, -0.04)
        add(cx + 0.095, 0.17, 0.065, 0.035)
        add(cx - 0.125, 0.11, 0.045, -0.015)
        add(cx + 0.18, 0.08, 0.04, 0.02)
        add(cx + 0.02, 0.09, 0.03, 0.0)
    elif form_key == "ring_cluster":
        for i in range(9):
            a = (i / 9.0) * math.tau + rnd.random() * 0.2
            add(cx + math.cos(a) * 0.17, 0.10 + rnd.random() * 0.07,
                0.04 + rnd.random() * 0.025, math.cos(a) * 0.02)
    elif form_key == "crystal_crest":
        for i in range(-3, 4):
            k = 1 - abs(i) / 4.0
            add(cx + i * 0.115, 0.12 + k * 0.22 + jitter(0.02),
                0.045 + k * 0.03, i * 0.012)
        add(cx, 0.29, 0.075, 0.0)
    elif form_key == "leaning_spire":
        add(cx + 0.075, 0.38, 0.09, 0.09)
        add(cx - 0.10, 0.13, 0.055, -0.03)
        add(cx - 0.035, 0.17, 0.045, -0.01)
        add(cx + 0.17, 0.10, 0.04, 0.05)
    elif form_key == "split_geode":
        add(cx - 0.075, 0.25, 0.11, -0.05)
        add(cx + 0.085, 0.23, 0.105, 0.055)
        add(cx, 0.12, 0.045, 0.0)
        add(cx - 0.175, 0.10, 0.04, -0.03)
        add(cx + 0.185, 0.11, 0.04, 0.03)
    elif form_key == "wild_growth":
        for _ in range(13):
            a = rnd.random() * math.tau
            rr = 0.03 + rnd.random() * 0.20
            add(cx + math.cos(a) * rr, 0.08 + rnd.random() * 0.28,
                0.035 + rnd.random() * 0.045, math.cos(a) * 0.05)
    else:
        add(cx, 0.28, 0.10, 0.0)
    return out


def make_depth_png(form_key, seed, out_path):
    img = Image.new("L", (SIZE, SIZE), 0)
    d = ImageDraw.Draw(img)
    cx = SIZE / 2
    base_y = BOTTOM_Y
    half_w = 285 + (seed % 3) * 22
    half_d = int(round(half_w * FLOOR_SLOPE))

    def pt(x, y):
        return int(round(x)), int(round(y))

    left = pt(cx - half_w, base_y - half_d)
    front = pt(cx, base_y)
    right = pt(cx + half_w, base_y - half_d)
    back = pt(cx, base_y - half_d * 2)

    # 30° 菱形土堆：近地线为前两条边（灰度稍低，给模型明确接地结构）
    d.polygon([left, back, right], fill=205)
    d.polygon([left, front, right], fill=232)
    d.line([left, front, right], fill=250, width=5)

    shards = make_shards(form_key, seed)
    shards.sort(key=lambda s: s[1])
    max_h = max(s[1] for s in shards)
    # 深度图主体：晶柱越高越近（越白）；顶点画亮线
    for x, h, bw, lean in shards:
        x = cx + x * SIZE * 0.92
        w = bw * SIZE * 0.92
        hh = h * (BOTTOM_Y - 260)
        ground_y = base_y - half_d * 0.72
        apex = pt(x + lean * SIZE, ground_y - hh)
        p = [
            pt(x - w / 2, ground_y),
            pt(x + w / 2, ground_y),
            pt(x + w * 0.48 + lean * SIZE * 0.3, ground_y - hh * 0.2),
            apex,
            pt(x - w * 0.48 + lean * SIZE * 0.3, ground_y - hh * 0.2),
        ]
        # 高度映射：最高柱最亮，矮柱略退后
        tone = int(238 + 17 * (h / max_h))
        d.polygon(p, fill=tone)
        d.line([p[3], p[4]], fill=255, width=4)

    img.save(out_path)
    print("depth ->", out_path)


def write_prompt(path, text):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def crop_to_alpha(path, margin=2):
    """AI 透明底为 1024×1024，主体可能只占中部；按 alpha 紧身裁切到可见内容。
    保留 2px 安全边，让 EnergyNode 按真实宽高比计算显示尺寸，避免节点缩得过小。"""
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return False
    x0 = max(0, int(xs.min()) - margin)
    y0 = max(0, int(ys.min()) - margin)
    x1 = min(im.width, int(xs.max()) + 1 + margin)
    y1 = min(im.height, int(ys.max()) + 1 + margin)
    tmp = path + ".crop.tmp.png"
    crop = np.asarray(im)[y0:y1, x0:x1].copy()
    Image.fromarray(crop).save(tmp, optimize=True)
    os.replace(tmp, path)
    return True


def run_comfy(args, prompt_file, depth_file, out_file, seed, key):
    cmd = [
        sys.executable, GEN,
        "--host", args.host,
        "--port", str(args.port),
        "--model", args.model,
        "--control-image", depth_file,
        "--strength", str(args.strength),
        "--prompt-file", prompt_file,
        "--seed", str(seed),
        "--size", args.size,
        "--steps", str(args.steps),
        "--timeout", str(args.timeout),
        "--transparent",
        "--out", out_file,
    ]
    if getattr(args, "no_refine", False):
        cmd += ["--no-refine"]
    if args.model == "sdxl" and args.negative:
        cmd += ["--negative", args.negative]
    print(f"[{key}] running: {' '.join(cmd)}", flush=True)
    return subprocess.run(cmd, capture_output=True, text=True, timeout=args.timeout + 120)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="192.168.3.142")
    ap.add_argument("--port", type=int, default=8188)
    ap.add_argument("--model", default="flux2-dev-depth")
    ap.add_argument("--strength", type=float, default=0.72)
    ap.add_argument("--size", default="1024x1024")
    ap.add_argument("--steps", type=int, default=24)
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--negative", default=None, help="仅 sdxl checkpoint 生效")
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 形态，0=全部 12")
    ap.add_argument("--skip-depth", action="store_true")
    ap.add_argument("--depth-only", action="store_true", help="只生成 12 张深度控制图后退出")
    ap.add_argument("--no-refine", action="store_true", help="透明抠图跳过 BiRefNet/GrabCut 精修（5080 快速出图时推荐）")
    ap.add_argument("--resume", action="store_true", help="已存在 out.png 且 >10KB 则跳过")
    ap.add_argument("--install", action="store_true", help="复制最终抠图到 assets/terrain")
    args = ap.parse_args()

    os.makedirs(DEPTH_DIR, exist_ok=True)
    os.makedirs(RAW_DIR, exist_ok=True)
    os.makedirs(PROMPT_DIR, exist_ok=True)

    forms = FORMS[: max(0, args.limit)] if args.limit > 0 else FORMS
    failed = []
    for idx, (form_key, seed, theme) in enumerate(forms, 1):
        depth_file = os.path.join(DEPTH_DIR, f"energy_node_v3_{idx}.png")
        if not args.skip_depth or not os.path.exists(depth_file):
            make_depth_png(form_key, seed, depth_file)
        if args.depth_only:
            continue

    if args.depth_only:
        print(f"[energy-node-v3] depth-only done: {len(forms)} depth maps -> {DEPTH_DIR}")
        return

    for idx, (form_key, seed, theme) in enumerate(forms, 1):
        depth_file = os.path.join(DEPTH_DIR, f"energy_node_v3_{idx}.png")

        normal_out = os.path.join(RAW_DIR, f"energy_node_v3_{idx}.png")
        depleted_out = os.path.join(RAW_DIR, f"energy_node_depleted_v3_{idx}.png")
        for tag, out, seed_base in (("normal", normal_out, 3000 + idx), ("depleted", depleted_out, 4000 + idx)):
            prompt_file = os.path.join(PROMPT_DIR, f"{tag}_{idx}.txt")
            write_prompt(prompt_file, prompt_for(theme, depleted=(tag == "depleted")))
            if args.resume and os.path.exists(out) and os.path.getsize(out) > 10 * 1024:
                crop_to_alpha(out)
                print(f"[{idx}/12 {tag}] skip existing {out}", flush=True)
                continue
            try:
                r = run_comfy(args, prompt_file, depth_file, out, seed_base, f"{idx}/12 {form_key} {tag}")
            except subprocess.TimeoutExpired:
                print(f"[{idx}/12 {form_key} {tag}] TIMEOUT", flush=True)
                failed.append(f"{idx}:{tag}")
                continue
            if r.returncode != 0 or not os.path.exists(out):
                print(f"[{idx}/12 {form_key} {tag}] FAIL rc={r.returncode}", flush=True)
                if r.stdout:
                    print(r.stdout[-1600:], flush=True)
                if r.stderr:
                    print(r.stderr[-1600:], flush=True)
                failed.append(f"{idx}:{tag}")
            else:
                crop_to_alpha(out)
                print(f"[{idx}/12 {form_key} {tag}] OK -> {out}", flush=True)

    if args.install:
        os.makedirs(ASSET_DIR, exist_ok=True)
        installed = 0
        for idx in range(1, len(forms) + 1):
            for src, dst in (
                (os.path.join(RAW_DIR, f"energy_node_v3_{idx}.png"),
                 os.path.join(ASSET_DIR, f"energy_node_v3_{idx}.png")),
                (os.path.join(RAW_DIR, f"energy_node_depleted_v3_{idx}.png"),
                 os.path.join(ASSET_DIR, f"energy_node_depleted_v3_{idx}.png")),
            ):
                if os.path.exists(src) and os.path.getsize(src) > 10 * 1024:
                    shutil.copy2(src, dst)
                    installed += 1
                    print("install ->", dst)
        print(f"[energy-node-v3] installed {installed} files to {ASSET_DIR}")

    print(f"[energy-node-v3] done. failed={len(failed)}")
    if failed:
        print("failed items: " + ", ".join(failed))
        sys.exit(1)


if __name__ == "__main__":
    main()
