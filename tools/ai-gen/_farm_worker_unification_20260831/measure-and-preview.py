"""Read farm-worker configuration and sprite pixels; write an offline size report.

This does not start the game, run tests, or modify game configuration/assets.
"""
from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
FARMS = ("cheese_farm", "corn_farm", "mushroom_farm")
LOADED = dict(zip(FARMS, ("cheese_loaded_running", "corn_loaded_running", "mushroom_loaded_running")))
LABELS = {"cheese_farm": "奶酪农场", "corn_farm": "玉米农场", "mushroom_farm": "蘑菇农场", "windmill": "风车田间农夫"}


def cells(animation):
    sheet = Image.open(REPO / animation["src"]).convert("RGBA")
    width, height = animation["frameWidth"], animation["frameHeight"]
    cols = sheet.width // width
    return [sheet.crop((i % cols * width, i // cols * height,
                        i % cols * width + width, i // cols * height + height))
            for i in range(animation["frameCount"])]


def measure(config):
    result = {}
    for kind in (*FARMS, "windmill"):
        cfg = config[kind]
        visual = cfg["workerVisual"]
        row = dict(label=LABELS[kind], workerSlots=cfg["workerSlots"],
                   visualWorkerCap=cfg["visualWorkerCap"],
                   baseMoveSpeed=cfg.get("baseMoveSpeed"),
                   fieldMoveSpeed=visual.get("moveSpeed"),
                   workerOutputEfficiencyShare=cfg.get("workerOutputEfficiencyShare"),
                   displaySize=visual["displaySize"], originY=visual["originY"], animations={})
        for name, animation in visual["animations"].items():
            heights, feet = [], []
            for cell in cells(animation):
                box = cell.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
                heights.append(box[3] - box[1])
                feet.append(box[3] - 1)
            height = float(statistics.median(heights))
            scale = animation.get("scale", 1)
            pixel_scale = visual["displaySize"] * scale / animation["frameHeight"]
            row["animations"][name] = dict(src=animation["src"], frameWidth=animation["frameWidth"],
                frameHeight=animation["frameHeight"], frameCount=animation["frameCount"],
                frameRate=animation["frameRate"], cycleMs=animation["frameCount"] / animation["frameRate"] * 1000,
                scale=scale, footRatio=animation.get("footRatio"),
                sourceHeightMedian=height, sourceHeightRange=[min(heights), max(heights)],
                sourceFootRange=[min(feet), max(feet)], worldHeightMedian=height * pixel_scale,
                worldHeightRange=[min(heights) * pixel_scale, max(heights) * pixel_scale])
        result[kind] = row
    return result


def draw_preview(config, report, stage):
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 19)
    small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 15)
    canvas = Image.new("RGB", (1080, 775), "#20262e")
    draw = ImageDraw.Draw(canvas)
    draw.text((24, 15), f"农场送仓员工尺寸统计 · {stage} · 2倍显示，仅离线素材预览", font=font, fill="#f0dcaa")
    for col, kind in enumerate(FARMS):
        cfg = config[kind]
        visual = cfg["workerVisual"]
        x = 180 + col * 360
        draw.text((col * 360 + 85, 52), LABELS[kind], font=font, fill="white")
        for row, state in enumerate(("idle", LOADED[kind], "empty_running")):
            definition = visual["animations"][state]
            frames = cells(definition)
            index = int(definition.get("holdFrame", 0))
            cell = frames[index]
            size = visual["displaySize"] * definition.get("scale", 1) * 2
            size = round(size)
            origin = definition["footRatio"] - (visual["animations"]["idle"]["footRatio"] - visual["originY"]) / definition.get("scale", 1)
            ground = 282 + row * 224
            resized = cell.convert("RGBa").resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
            canvas.paste(resized, (x - size // 2, ground - round(size * origin)), resized)
            draw.line((col * 360 + 20, ground, col * 360 + 340, ground), fill="#66826b", width=1)
            height = report[kind]["animations"][state]["worldHeightMedian"]
            label = ("待机", "抱货送仓", "空手返回")[row]
            draw.text((col * 360 + 30, ground + 8), f"{label}：主体中位高度 {height:.2f}px", font=small, fill="#d5d9dd")
    canvas.save(ROOT / f"{stage}-comparison.png")


def draw_mushroom_animation(config):
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17)
    choices = [("cheese_farm", "idle", "奶酪农场：78px基准"),
               ("mushroom_farm", "mushroom_loaded_running", "蘑菇农场：抱货送仓"),
               ("mushroom_farm", "empty_running", "蘑菇农场：空手返回")]
    sources = [cells(config[kind]["workerVisual"]["animations"][state]) for kind, state, _ in choices]
    images = []
    for index in range(30):
        canvas = Image.new("RGB", (840, 300), "#20262e")
        draw = ImageDraw.Draw(canvas)
        for col, (kind, state, label) in enumerate(choices):
            visual = config[kind]["workerVisual"]
            animation = visual["animations"][state]
            cell = sources[col][0 if col == 0 else index]
            if col == 2:
                cell = cell.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            scale = animation.get("scale", 1)
            size = round(visual["displaySize"] * scale * 2)
            origin = animation["footRatio"] - (visual["animations"]["idle"]["footRatio"] - visual["originY"]) / scale
            resized = cell.convert("RGBa").resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
            canvas.paste(resized, (col * 280 + 140 - size // 2, 245 - round(size * origin)), resized)
            draw.text((col * 280 + 36, 16), label, font=font, fill="#e8e0c9")
            draw.line((col * 280 + 20, 245, col * 280 + 260, 245), fill="#638067")
        draw.text((24, 272), "2倍显示 · 基础80px/s对应24fps · 仅素材预览，未运行游戏", font=font, fill="#c9d0d6")
        images.append(canvas)
    durations = [10 * (round((i + 1) * 100 / 24) - round(i * 100 / 24)) for i in range(30)]
    images[0].save(ROOT / "after-mushroom-animation.gif", save_all=True,
                   append_images=images[1:], duration=durations, disposal=2, loop=0, optimize=False)
    images[0].save(ROOT / "after-mushroom-animation.png")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", required=True, choices=("before", "after"))
    args = parser.parse_args()
    config = json.loads((REPO / "data/population-economy.json").read_text(encoding="utf-8"))
    report = measure(config)
    (ROOT / f"{args.stage}-statistics.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    draw_preview(config, report, args.stage)
    if args.stage == "after":
        draw_mushroom_animation(config)
    for kind, row in report.items():
        print(kind, "display", row["displaySize"], "speed", row["baseMoveSpeed"])
        for name, values in row["animations"].items():
            print(f"  {name}: sourceHeight={values['sourceHeightMedian']:.2f} worldHeight={values['worldHeightMedian']:.4f} foot={values['sourceFootRange']} cycle={values['cycleMs']:.2f}ms")


if __name__ == "__main__":
    main()
