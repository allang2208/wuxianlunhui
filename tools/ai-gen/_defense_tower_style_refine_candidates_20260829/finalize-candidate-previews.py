#!/usr/bin/env python3
"""Lock formal Alpha and compose current-scale base + arm + weapon previews."""
from pathlib import Path
import json

from PIL import Image, ImageDraw, ImageFont, ImageEnhance
import numpy as np


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
RENDERS = HERE / "renders"
PREVIEWS = HERE / "previews"
PREVIEWS.mkdir(parents=True, exist_ok=True)

BASE_REF = Image.open(ROOT / "assets/terrain/obstacle_defense_tower.png").convert("RGBA")
ARM_SHEET_REF = Image.open(ROOT / "assets/terrain/obstacle_defense_tower_arm_frames.png").convert("RGBA")
ARM_REF = ARM_SHEET_REF.crop((0, 0, 261, 164))
FLOOR = Image.open(ROOT / "assets/terrain/floor_sand_seamless.png").convert("RGB")
BARREL = Image.open(ROOT / "assets/terrain/tower_barrel_weapon11.png").convert("RGBA")

BASE_DISPLAY = (279, 429)
ASSEMBLY_SCALE = 1.643002
ARM_DISPLAY = (round(137 * ASSEMBLY_SCALE), round(86 * ASSEMBLY_SCALE))
PIVOT_WORLD_Y = 235 * ASSEMBLY_SCALE

VARIANTS = [
    ("candidate_3", "03  现代防御型 · 冷灰预制 / 蓝黑钢", "更清晰：暗黄维护标 + 微量青蓝"),
]


def content_bbox(image, threshold=8):
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.nonzero(alpha > threshold)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def fit_locked_alpha(full, reference, fixed_crop=None):
    crop = full.crop(fixed_crop) if fixed_crop else full.crop(content_bbox(full))
    if crop.size != reference.size:
        crop = crop.resize(reference.size, Image.Resampling.LANCZOS)
    crop.putalpha(reference.getchannel("A"))
    return crop


def add_service_marks(base, variant_id):
    """Texture-paint accents only; silhouette and geometry remain untouched."""
    out = base.copy()
    layer = Image.new("RGBA", out.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer, "RGBA")
    if variant_id == "candidate_1":
        accent, brass = (65, 145, 150, 180), (155, 104, 46, 205)
        draw.polygon([(135, 302), (143, 298), (143, 326), (135, 330)], fill=accent)
        draw.polygon([(147, 296), (153, 293), (153, 322), (147, 325)], fill=(62, 122, 128, 135))
        for x in (94, 124, 200, 230):
            draw.ellipse((x - 3, 398, x + 3, 404), fill=brass)
    elif variant_id == "candidate_2":
        bronze = (132, 86, 42, 190)
        for x in (82, 112, 212, 242):
            draw.ellipse((x - 3, 397, x + 3, 403), fill=bronze)
        draw.line((108, 323, 126, 314), fill=(87, 78, 66, 135), width=3)
    else:
        amber, cyan = (184, 130, 43, 205), (67, 132, 147, 145)
        draw.polygon([(132, 309), (143, 303), (151, 307), (140, 313)], fill=amber)
        draw.polygon([(143, 320), (154, 314), (162, 318), (151, 324)], fill=amber)
        draw.rectangle((169, 302, 174, 326), fill=cyan)
    layer.putalpha(Image.composite(layer.getchannel("A"), Image.new("L", out.size), out.getchannel("A")))
    out = Image.alpha_composite(out, layer)
    out.putalpha(base.getchannel("A"))
    return out


def font(size, bold=False):
    name = "C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"
    try:
        return ImageFont.truetype(name, size)
    except OSError:
        return ImageFont.load_default()


def floor_background(width, height):
    needed_h = round(height / 0.5774)
    tile = Image.new("RGB", (width, needed_h))
    for y in range(0, needed_h, FLOOR.height):
        for x in range(0, width, FLOOR.width):
            tile.paste(FLOOR, (x, y))
    tile = tile.resize((width, height), Image.Resampling.LANCZOS)
    tile = ImageEnhance.Color(tile).enhance(0.74)
    tile = ImageEnhance.Brightness(tile).enhance(0.70)
    return tile.convert("RGBA")


def compose_panel(base, arm, title, note):
    width, height = 560, 600
    panel = floor_background(width, height)
    overlay = Image.new("RGBA", panel.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay, "RGBA")
    od.rectangle((0, 0, width, 74), fill=(17, 22, 27, 232))
    od.text((18, 11), title, font=font(20, True), fill=(238, 241, 243, 255))
    od.text((18, 42), note, font=font(13), fill=(184, 195, 203, 255))

    cx, ground_y = width // 2, 550
    ground_center_y = ground_y - 64
    diamond = [
        (cx, ground_center_y - 64), (cx + 128, ground_center_y),
        (cx, ground_center_y + 64), (cx - 128, ground_center_y),
    ]
    od.polygon(diamond, fill=(196, 143, 73, 24), outline=(235, 184, 101, 128))
    od.text((18, height - 30), "当前实际比例 · 2×2 碰撞菱形 256×128", font=font(12), fill=(210, 214, 215, 225))
    panel = Image.alpha_composite(panel, overlay)

    base_runtime = base.resize(BASE_DISPLAY, Image.Resampling.LANCZOS)
    panel.alpha_composite(base_runtime, (cx - BASE_DISPLAY[0] // 2, ground_y - BASE_DISPLAY[1]))

    arm_runtime = arm.resize(ARM_DISPLAY, Image.Resampling.LANCZOS)
    pivot_x = round(131 / 261 * ARM_DISPLAY[0])
    pivot_y = round(82 / 164 * ARM_DISPLAY[1])
    world_pivot_y = round(ground_y - PIVOT_WORLD_Y)
    panel.alpha_composite(arm_runtime, (cx - pivot_x, world_pivot_y - pivot_y))

    barrel_h = round(11 * ASSEMBLY_SCALE)
    barrel_w = round(BARREL.width * barrel_h / max(1, BARREL.height))
    barrel = BARREL.resize((barrel_w, barrel_h), Image.Resampling.LANCZOS)
    tip_x = round(cx + 0.524691 * ASSEMBLY_SCALE * 2.56 * 50)
    root_inset = round(7 * ASSEMBLY_SCALE)
    panel.alpha_composite(barrel, (tip_x - root_inset, world_pivot_y - barrel_h // 2))
    return panel


def main():
    panels = []
    report = {"runtimeAssetsTouched": False, "variants": []}
    for variant_id, title, note in VARIANTS:
        base_full = Image.open(RENDERS / f"{variant_id}_base_full.png").convert("RGBA")
        arm_full = Image.open(RENDERS / f"{variant_id}_arm_full.png").convert("RGBA")
        base_bbox = content_bbox(base_full)
        base = add_service_marks(fit_locked_alpha(base_full, BASE_REF), variant_id)
        arm = fit_locked_alpha(arm_full, ARM_REF, (330, 430, 591, 594))
        base_path = RENDERS / f"{variant_id}_base_locked.png"
        arm_path = RENDERS / f"{variant_id}_arm_frame0_locked.png"
        base.save(base_path)
        arm.save(arm_path)
        panel = compose_panel(base, arm, title, note)
        panel_path = PREVIEWS / f"{variant_id}_world_actual_size.png"
        panel.save(panel_path)
        panels.append(panel)
        report["variants"].append({
            "id": variant_id,
            "rawBaseBBox": list(base_bbox),
            "lockedBaseSize": list(base.size),
            "lockedArmFrameSize": list(arm.size),
            "baseAlphaExact": base.getchannel("A").tobytes() == BASE_REF.getchannel("A").tobytes(),
            "armAlphaExact": arm.getchannel("A").tobytes() == ARM_REF.getchannel("A").tobytes(),
            "preview": str(panel_path.relative_to(ROOT)).replace("\\", "/"),
        })

    sheet = Image.new("RGBA", (sum(p.width for p in panels), max(p.height for p in panels)), (17, 21, 25, 255))
    x = 0
    for panel in panels:
        sheet.alpha_composite(panel, (x, 0))
        x += panel.width
    sheet_path = PREVIEWS / "defense_tower_style_refine_contact.png"
    sheet.save(sheet_path)
    report["contactSheet"] = str(sheet_path.relative_to(ROOT)).replace("\\", "/")
    with (HERE / "candidate-report.json").open("w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
