"""Produce material candidates and an offline full-leaf/fade presentation.

Never uploads, installs assets, launches the game or runs a test harness.
"""
import importlib.util
import json
import math
from pathlib import Path
import re

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BATCH = HERE / "_mine_wall_dev_final_20260830"
SOURCE = HERE / "_mine_wall_pbr_kit_v2_20260830"
MOTION = HERE / "_mine_gate_fade_20260830"


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


render = module("mine_review_assembly", "compose-mine-wall-pbr-kit-v2.py")
finish = module("mine_review_material", "finalize-abandoned-mine-wall-kit-ai12.py")


def material_candidates():
    for kind in ("supports", "gate"):
        folder = BATCH / kind
        base_path = BATCH / "wall_c_stone_base.png" if kind == "supports" else SOURCE / "gate_frames/gate_00.png"
        base = Image.open(base_path).convert("RGBA")
        src = np.asarray(base)
        if kind == "supports":
            masks = np.asarray(Image.open(BATCH / "wall_c_component_mask.png").convert("RGBA"))
            regions = [masks[..., 0], masks[..., 1]]
        else:
            regions = [src[..., 3]]
        candidates = []
        for number in (1, 2):
            raw = folder / f"{kind}_v{number:02d}_raw.png"
            mat = np.asarray(finish.exact_alpha_material(base, raw))
            output = src[..., :3].astype(float).copy()
            for region in regions:
                weight = np.clip((distance_transform_edt(region > 240) - 1) / 4, 0, 1) * .85
                old_low = np.stack([finish._masked_low_frequency(src[..., c] / 255, region, 24) for c in range(3)], axis=-1)
                new_low = np.stack([finish._masked_low_frequency(mat[..., c] / 255, region, 24) for c in range(3)], axis=-1)
                gain = np.clip(old_low / np.maximum(new_low, 1/255), .15, 4)
                material = np.clip(mat[..., :3] * gain, 0, 255)
                output = output * (1-weight[..., None]) + material * weight[..., None]
            result = Image.fromarray(np.dstack((np.uint8(np.rint(output)), src[..., 3])), "RGBA")
            result.save(folder / f"{kind}_v{number:02d}_candidate.png")
            candidates.append(result)
        contact = Image.new("RGBA", (1650, 1150), (26, 31, 35, 255))
        render.label(contact, (24, 20), "木撑精修 · 仅替换原模型木铁区域" if kind == "supports" else "门叶精修 · 原九木条轮廓与间隙", 28)
        render.label(contact, (24, 65), "原版 / Dev48 01 / Dev48 02；候选未安装，原Alpha与低频色调保留。", 20)
        for col, sprite in enumerate([base] + candidates):
            contact.alpha_composite(sprite.resize((530, 530), Image.Resampling.LANCZOS), (10+col*550, 120))
            render.label(contact, (30+col*550, 665), ("当前原版", "Dev48 01", "Dev48 02")[col], 24)
            if kind == "supports":
                # Component close-up from the same final candidate, not a separately generated detail.
                detail = sprite.crop((220, 330, 490, 830)).resize((240, 445), Image.Resampling.LANCZOS)
                contact.alpha_composite(detail, (155+col*550, 710))
            else:
                detail = sprite.crop((265, 175, 455, 500)).resize((250, 428), Image.Resampling.LANCZOS)
                contact.alpha_composite(detail, (150+col*550, 710))
        contact.save(folder / "material-review.png")
        write_json(folder / "review.json", {
            "stage": "two Dev48 candidates produced; pending final material selection",
            "runtimeInstalled": False, "approved": False,
            "source": base_path.relative_to(HERE).as_posix(),
            "model": "flux2-dev-depth", "configuredSteps": 48, "denoise": .3,
            "method": "authored alpha and component boundaries; low-frequency RGB matching; 85% interior material",
            "variants": [{"id": i, "raw": f"{kind}_v{i:02d}_raw.png", "candidate": f"{kind}_v{i:02d}_candidate.png"} for i in (1, 2)],
            "preview": "material-review.png",
            "limits": "Only material refinement; modeled relief and timber shape unchanged. No runtime validation.",
        })


def motion_preview():
    MOTION.mkdir(exist_ok=True)
    geometry = json.loads((SOURCE / "geometry.json").read_text(encoding="utf-8"))
    wall_geo, gate_geo = geometry["wall"], geometry["gate"]
    # Consume the actual runtime configuration without importing/starting the game.
    config_text = (ROOT / "src/world/wall-system.js").read_text(encoding="utf-8")
    match = re.search(r"leafMotion:\s*\{\s*fadeFraction:\s*([\d.]+),\s*liftPixels:\s*(\[[^\]]+\])", config_text)
    fade_fraction, lifts = float(match[1]), json.loads(match[2])
    sprites = {key: Image.open(ROOT / f"assets/terrain/abandoned_mine_wall_block_{key}.png").convert("RGBA") for key in "abc"}
    leaf = Image.open(ROOT / "assets/terrain/abandoned_mine_gate.png").convert("RGBA").crop((0, 0, 640, 640))

    def state(openness):
        sample = min(1, openness / (1-fade_fraction)) * (len(lifts)-1)
        lo, hi = math.floor(sample), min(math.floor(sample)+1, len(lifts)-1)
        lift = lifts[lo] + (lifts[hi]-lifts[lo]) * (sample-lo)
        fade = max(0, min(1, (openness-(1-fade_fraction))/fade_fraction))
        return lift, 1-fade*fade*(3-2*fade)

    def draw(openness, title):
        lift, alpha = state(openness)
        canvas = Image.new("RGBA", (1340, 870), (24, 29, 33, 255))
        render.label(canvas, (24, 18), "矿洞门 · 完整门叶 + 顶部淡入淡出（离线素材呈现）", 27)
        render.label(canvas, (24, 62), title, 21)
        for flip in (False, True):
            origin = (1195 if flip else 145, 550)
            cells = [(0, i) if flip else (i, 0) for i in (-1, 0, 6, 7)]
            jobs = render.assembly.mixed_jobs(cells, origin, sprites, wall_geo)
            sy = 192 / (gate_geo["base"][1][1] - gate_geo["base"][0][1])
            for depth, kind, (sprite, position) in render.gate_jobs(origin, leaf, gate_geo, flip):
                sprite.putalpha(sprite.getchannel("A").point(lambda a: round(a*alpha)))
                jobs.append((depth, kind, (sprite, (position[0], round(position[1]-lift*sy)))))
            render.paint(canvas, jobs)
        render.label(canvas, (24, 820), "720ms原关键轨迹插值 + 180ms淡化；保留六段depth、门底线与碰撞时机。", 20)
        return canvas.convert("RGB")

    sequence = [(1, 500, "已开启：门叶不可见")]
    sequence += [(1-t/900, 30, "关门：先淡入180ms，再下落720ms") for t in range(0, 900, 30)]
    sequence += [(0, 650, "已关闭：完整门叶")]
    sequence += [(t/900, 30, "开门：先升起720ms，再淡出180ms") for t in range(0, 900, 30)]
    images = [draw(p, title) for p, _, title in sequence]
    images[0].save(MOTION / "gate-full-leaf-fade.gif", save_all=True, append_images=images[1:],
                   duration=[ms for _, ms, _ in sequence], loop=0, disposal=2)
    frames = [(1, "关门起点：透明"), (.9, "90ms：完整门叶半透明"), (.8, "180ms：淡入完成"), (.5, "450ms：下落中"), (0, "900ms：关闭")]
    contact = Image.new("RGB", (2010, 870), (24, 29, 33))
    for index, (p, title) in enumerate(frames):
        contact.paste(draw(p, title).resize((670, 435), Image.Resampling.LANCZOS), ((index % 3)*670, (index//3)*435))
    contact.save(MOTION / "gate-fade-stages.png")
    write_json(MOTION / "manifest.json", {
        "stage": "runtime visual implementation installed; offline presentation only",
        "runtimeCodeChanged": True, "assetPixelsChanged": False,
        "source": "assets/terrain/abandoned_mine_gate.png frame0; original complete rigid leaf",
        "runtimeConfig": "src/world/wall-system.js abandoned_mine_gate.leafMotion",
        "runtimeHelper": "src/world/gate-visual-state.js bindGateLeafMotion",
        "durationMs": 900, "movementMs": 720, "fadeMs": 180,
        "liftPixels": lifts, "fadeFraction": fade_fraction,
        "closing": "fade in full raised leaf, then lower", "opening": "raise full leaf, then fade out",
        "unchanged": ["original gate alpha", "nine slats", "six source-column crops", "depth ordering", "collision timing", "other dungeon gate animation"],
        "preview": "gate-full-leaf-fade.gif", "stages": "gate-fade-stages.png",
        "tests": "未运行测试或运行时验证，按约定由用户测试。",
        "limits": "Offline composition is not Phaser proof. Gate now remains complete above wall height during the brief top fade.",
    })


if __name__ == "__main__":
    material_candidates()
    motion_preview()
    print("Produced Dev material candidate reviews and complete-leaf fade GIF; no runtime assets installed.")
