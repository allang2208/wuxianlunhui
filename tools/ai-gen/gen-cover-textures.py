#!/usr/bin/env python3
"""路线 B：批量生成墙段材质纹理（AI 只出材质，几何由 Blender 控制）。

尺寸 1024×668 = 墙段正面比例（230:150 ≈ 1.53:1），避免纹理贴到正面被横向拉伸。
产出：Y:\\工作\\无尽轮回\\scratch\\world122\\raw\\tex_<grade>_<theme>.png
2026-08-05：支持 --variants N 生成每级 N 个"高度类似、细节微调"的变体
（tex_<g>_v1..vN），v1 即定稿主题，v2+ 加细微修饰（A 级替换大符文形态），
供游戏内随机贴图库使用（防单调）。
"""
import argparse
import os
import subprocess

DIR = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(DIR, "comfyui-gen.py")
OUT_DIR = r"Y:\工作\无尽轮回\scratch\world122\raw"

THEME = {
    "F": "weathered pale gray brick wall, regular square brick grid pattern with rectangular bricks aligned in neat rows, old cracked and chipped bricks, crumbling mortar joints, aged worn surface",
    "E": "sandstone brick wall, regular square brick grid in warm sand and beige tones, smooth carved sandstone blocks, precise brickwork, desert fortification, no sandbags, no white areas",
    "D": "regular square brick wall, neat grid of rectangular bricks in warm gray and reddish tones, uniform mortar joints, chipped edges and weathered surface, slight moss in joints",
    "C": "regular square grid of steel-gray concrete fortification blocks, cool gray-blue concrete brick wall with clear visible brick grid and crisp mortar joints, rusted steel corner plates as small accents at block corners only, bright even lighting with subtle highlight and shadow detail on the concrete surface, rich surface texture, high contrast between concrete blocks and mortar lines, massive thick fortified wall, strong imposing presence",
    "B": "regular square grid of dark charcoal steel-blue armored bricks, each brick faced with a riveted steel armor plate, heavy riveted gunmetal armor plating, imposing high-strength wall",
    "A": "regular square grid of obsidian black bricks with one single large glowing blue rune engraved across the center of the wall, exactly one large rune, luminous cyan-blue rune glow, black and blue arcane fortification, legendary tier, no small runes, no repeated runes",
}

# 变体修饰词（v2~v5，高度类似仅微调细节；v1 为定稿主题）
VARIANT_SUFFIX = [
    "",  # 占位（v1）
    "with slightly lighter weathered surface and softer brick tones",
    "with darker aged tones, deeper cracks and more chipped wear",
    "with more moss and grime in the mortar joints",
    "with a warmer color cast and more prominent grain texture",
]
# A 级大符文随机替换（v2~v5 各一种形态；v1 保持定稿大符文）
A_RUNE_VARIANTS = [
    "one single large glowing blue rune engraved across the center of the wall, exactly one large angular rune, luminous cyan-blue rune glow",
    "one single large glowing blue circular rune symbol engraved on the wall center, exactly one large round rune, luminous cyan-blue rune glow",
    "one single large glowing blue vertical diamond-shaped rune engraved on the wall center, exactly one large rune, luminous cyan-blue rune glow",
    "one single large glowing blue cross-like rune engraved on the wall center, exactly one large rune, luminous cyan-blue rune glow",
]
# A 级基础（黑砖 + 大符文，v2+ 用 A_RUNE_VARIANTS 替换符文段）
A_BASE = (
    "regular square grid of obsidian black bricks, black and blue arcane fortification, "
    "legendary tier, no small runes, no repeated runes"
)
TAIL = (
    ", photorealistic PBR material texture, flat frontal view, extremely detailed, "
    "regular square brick grid pattern, rectangular bricks aligned in neat rows like a standard brick wall, "
    "bricks vary slightly in color tone with chipped uneven edges and wear marks, "
    "uniform thin mortar joints, refined precise construction, crisp clean brickwork, "
    "intricate surface detail, imposing heavy fortification, subtle wear marks, "
    "no white background, no pure white areas, "
    "no perspective distortion, "
    "flat diffuse even lighting, absolutely no shadows, no drop shadow, no ambient occlusion, "
    "no dark shading, no gradient lighting, no vignette, no text, no watermark"
)
NEG = (
    "blurry, low quality, watermark, text, signature, gradient, vignette, frame, border, "
    "people, hands, grass, ground, sky, perspective, isometric, 3D object, single object, "
    "shadows, drop shadow, cast shadow, ambient occlusion, dark shading, hard lighting, "
    "directional light, gradient lighting, repetitive pattern, repeating texture"
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--grades", default="FEDCBA", help="要生成的级别")
    ap.add_argument("--seed", type=int, default=4001)
    ap.add_argument("--model", default="flux2-dev-fp8",
                    help="ComfyUI 模型（默认 FLUX.2 Dev；其他模型仅在命令行显式指定）")
    ap.add_argument("--steps", type=int, default=48, help="生成步数（fp8 48 步细节饱满）")
    ap.add_argument("--variants", type=int, default=5, help="每级变体数（v1=定稿主题）")
    ap.add_argument("--from-variant", type=int, default=1, help="起始变体号（批量续跑/跳过 v1）")
    args = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    seed = args.seed
    for g in args.grades:
        for v in range(1, max(1, args.variants) + 1):
            if v < args.from_variant:
                continue
            out = os.path.join(OUT_DIR, f"tex_{g}_v{v}.png")
            if v == 1:
                prompt = THEME[g] + TAIL
            elif g == "A":
                prompt = A_BASE + ", " + A_RUNE_VARIANTS[v - 2] + TAIL
            else:
                prompt = THEME[g] + ", " + VARIANT_SUFFIX[v - 1] + TAIL
            cmd = [
                "python", GEN, "--host", "192.168.3.142", "--model", args.model,
                "--size", "1024x668", "--seed", str(seed), "--steps", str(args.steps),
                "--prompt", prompt, "--out", out,
            ]
            print(f"--- {g} v{v} (seed {seed}) ---", flush=True)
            r = subprocess.run(cmd)
            if r.returncode != 0:
                print(f"[{g}] v{v} FAILED rc={r.returncode}", flush=True)
            seed += 17


if __name__ == "__main__":
    main()
