#!/usr/bin/env python3
"""世界-122 防守地图 陷阱贴图批量生成（2026-08-07）。

4 类（spike 地刺 / mine 地雷 / tar 减速带 / burn 燃烧区）× F→A 六档 = 24 张。
走远程 5080 flux2-dev-fp8，白底原图输出到 scratch，再抠图入库 assets/terrain/。

用法：
    python tools/ai-gen/gen-trap-assets.py                    # 全量 24 张
    python tools/ai-gen/gen-trap-assets.py --keys spike_F mine_D   # 指定条目（先小批量验证）
"""
import argparse
import os
import subprocess
import sys

from prompt_principles import STYLE_BASELINE

DIR = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(DIR, "comfyui-gen.py")
HOST = "192.168.3.142"
MODEL = "flux2-dev-fp8"
OUT_DIR = r"Y:\工作\无尽轮回\scratch\world122\traps\raw"

VIEW = (
    "game asset prop, 2.5D isometric view matching the game's wall perspective, "
    "the trap stands on a floor line tilted 30 degrees, bottom edge aligned at "
    "exactly 30 degrees to the horizontal, front face visible, top surface slightly "
    "visible and foreshortened, low profile, single prop centered in frame, "
    "flat bottom, no wall, no stand"
)

# 地雷专用视角：圆形顶面占比大，必须用与掩体墙同构的句式强调"侧壁可见、顶面细椭圆"
VIEW_MINE = (
    "flat round mine lying flat on the ground, game isometric asset, seen from a "
    "30-degree elevated angle, the circular top is a foreshortened ellipse "
    "(not a full circle), only a thin low side wall is visible below the top rim, "
    "the mine is low and flat like a pancake, bottom edge aligned with the "
    "30-degree floor line, single prop centered in frame, no wall, no stand"
)

THEMES = {
    "spike": {
        "F": "simple wooden spike trap on the ground, short sharp wooden spikes protruding from a flat wooden base, weathered pale wood",
        "E": "iron spike trap on the ground, rusty iron spikes on a flat metal base plate, coarse dark iron",
        "D": "stone spike trap on the ground, heavy rough stone spikes on a flat stone base, mossy joints",
        "C": "steel spike trap on the ground, sharp polished steel spikes on a reinforced steel plate, riveted corners",
        "B": "armored spike trap on the ground, dark armored metal spikes with a heavy reinforced base, battle-worn steel",
        "A": "rune spike trap on the ground, black enchanted steel spikes with faint glowing energy runes on the base, advanced magical fortification",
    },
    "mine": {
        "F": "simple flat landmine lying on the ground, rusty pale iron round plate with a small pressure trigger knob on top",
        "E": "flat riveted landmine lying on the ground, coarse dark iron round plate with rivets and a center trigger on top",
        "D": "heavy flat landmine lying on the ground, worn dark cast-iron round plate with a large pressure plate on top",
        "C": "reinforced flat landmine lying on the ground, dark military steel round plate with reinforced ribs and a prominent trigger on top",
        "B": "armored flat landmine lying on the ground, layered armor round plate with a glowing warning strip on top, heavy battlefield steel",
        "A": "runed flat landmine lying on the ground, black arcane metal round plate with glowing blue energy runes and a pulsing core on top, advanced magical trap",
    },
    "tar": {
        "F": "small sticky tar puddle on the ground, a shallow dark tar patch with a glossy wet surface, organic black pitch",
        "E": "wide tar slick on the ground, dark sticky tar spreading flat with glossy highlights, thick black pitch",
        "D": "asphalt tar trap zone on the ground, a flat dark asphalt-tar area with a sticky glossy surface, road-grade pitch",
        "C": "reinforced tar trap zone on the ground, dark tar patch outlined by a low stone rim, sticky glossy surface",
        "B": "magical tar trap zone on the ground, dark viscous tar pool with faint purple glow veins, enchanted binding pitch",
        "A": "runed tar trap zone on the ground, black arcane tar pool with glowing blue runes around the rim and a shimmering surface, advanced magical binding trap",
    },
    "burn": {
        "F": "small burning ground patch, a small campfire-like flame area on the ground, orange fire with a few embers",
        "E": "burning ground zone, a flat burning patch of orange-red flames on the ground, scattered embers",
        "D": "intense burning ground zone, a larger flat fire area with bright orange flames and rising heat, scorched ground",
        "C": "high-temperature burning ground, vivid yellow-white flames on a scorched black ground patch, intense heat glow",
        "B": "magical burning ground, blue-white arcane flames on the ground with a soft glow, enchanted fire trap",
        "A": "runed burning ground, black scorched ground with a ring of glowing runes and tall blue-violet arcane flames, advanced magical fire trap",
    },
}

NEG = (
    "blurry, low quality, watermark, text, signature, gradient background, gray background, "
    "dark background, vignette, frame, border, people, hands, grass, floor texture, "
    "shadows, drop shadow, cast shadow, hard lighting, directional light, rim light, "
    "multiple objects, lineup, duplicate, top-down orthographic view, side view"
)


def items():
    out = []
    seed = 2001
    for ttype in ["spike", "mine", "tar", "burn"]:
        for grade in ["F", "E", "D", "C", "B", "A"]:
            view = VIEW_MINE if ttype == "mine" else VIEW
            prompt = f"{THEMES[ttype][grade]}, {view}, {STYLE_BASELINE}"
            out.append({
                "key": f"{ttype}_{grade}",
                "prompt": prompt,
                "negative": NEG,
                "seed": seed,
                "out": os.path.join(OUT_DIR, f"trap_{ttype}_{grade}.png"),
            })
            seed += 7
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", nargs="*", default=None, help="只生成指定条目，如 --keys spike_F mine_D")
    ap.add_argument("--timeout", type=int, default=1200, help="单张生成超时（秒，默认 1200）")
    ap.add_argument("--skip-existing", action="store_true", help="跳过已存在的输出文件（断点续传）")
    args = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    all_items = items()
    wanted = args.keys or [it["key"] for it in all_items]
    todo = [it for it in all_items if it["key"] in wanted]
    if args.skip_existing:
        before = len(todo)
        todo = [it for it in todo if not os.path.exists(it["out"])]
        print(f"跳过已存在 {before - len(todo)} 张，剩余 {len(todo)} 张")
    print(f"共 {len(todo)} 张待生成（{', '.join(it['key'] for it in todo)}）")
    for i, it in enumerate(todo):
        print(f"[{i+1}/{len(todo)}] {it['key']} → {it['out']}")
        cmd = [
            sys.executable, GEN,
            "--host", HOST,
            "--model", MODEL,
            "--prompt", it["prompt"],
            "--negative", it["negative"],
            "--seed", str(it["seed"]),
            "--out", it["out"],
            "--timeout", str(args.timeout),
        ]
        try:
            subprocess.run(cmd, check=True)
        except subprocess.CalledProcessError as e:
            print(f"⚠ {it['key']} 生成失败，跳过（{e}）")
    print("全部完成")


if __name__ == "__main__":
    main()
