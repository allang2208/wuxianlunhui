"""Compose modeled street renders into runtime assets and a review sheet."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "tools" / "ai-gen" / "_world122_street_decor_20260825"
ASSETS = REPO / "assets" / "terrain"
PROP_ASSETS = ASSETS / "street-props"
EDGE_ASSETS = ASSETS / "street-edges"
EDGE_CANDIDATES = SOURCE / "edge_assets_candidate"


def checker(size, cell=16):
    image = Image.new("RGBA", size, (31, 34, 38, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            color = (58, 62, 68, 255) if (x // cell + y // cell) % 2 else (42, 46, 51, 255)
            draw.rectangle((x, y, min(size[0], x + cell), min(size[1], y + cell)), fill=color)
    return image


def alpha_bbox_report(path):
    image = Image.open(path).convert("RGBA")
    box = image.getchannel("A").getbbox()
    return {
        "path": str(path.relative_to(REPO)).replace("\\", "/"),
        "size": list(image.size),
        "alphaBBox": list(box) if box else None,
        "alphaExtrema": list(image.getchannel("A").getextrema()),
    }


def clear_low_alpha(image, threshold=8):
    image = image.convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            if a < threshold:
                pixels[x, y] = (0, 0, 0, 0)
    return image


def compose_layout_preview(atlas, manifest):
    canvas = Image.new("RGBA", (1024, 640), (77, 68, 56, 255))
    frames = [atlas.crop((index * 128, 0, (index + 1) * 128, 64))
              for index in range(len(manifest["roads"]))]
    centers = {}
    for i in range(7):
        for j in range(7):
            x = 512 + (i - j) * 64
            y = 80 + (i + j) * 32
            centers[(i, j)] = (x, y)
            frame = frames[(i * 5 + j * 7) % len(frames)]
            canvas.alpha_composite(frame, (x - 64, y - 32))

    if manifest.get("edges"):
        edge_placements = []
        for index, value in enumerate((1, 3, 5)):
            variant = index % 2
            edge_placements.extend([
                ((0, value), f"street_edge_yp_{variant}"),
                ((6, value), f"street_edge_yn_{variant}"),
                ((value, 0), f"street_edge_xp_{variant}"),
                ((value, 6), f"street_edge_xn_{variant}"),
            ])
        for cell, name in edge_placements:
            cx, cy = centers[cell]
            edge = Image.open(EDGE_CANDIDATES / f"{name}.png").convert("RGBA")
            edge.putalpha(edge.getchannel("A").point(lambda value: round(value * 0.84)))
            canvas.alpha_composite(edge, (cx - 64, cy - 32))

    surface_placements = [
        ((1, 2), "street_trace_water_spill", (0, 0)),
        ((2, 3), "street_trace_footprints", (-8, -4)),
        ((3, 1), "street_trace_straw_scatter", (6, 2)),
        ((3, 5), "street_trace_cart_ruts", (0, 0)),
        ((4, 3), "street_trace_coal_smear", (-4, 1)),
        ((5, 5), "street_trace_oil_drips", (7, -3)),
    ]
    for cell, name, offset in surface_placements:
        cx, cy = centers[cell]
        trace = Image.open(SOURCE / "props" / f"{name}.png").convert("RGBA")
        trace = trace.resize((128, 128), Image.Resampling.LANCZOS)
        trace.putalpha(trace.getchannel("A").point(lambda value: round(value * 0.70)))
        canvas.alpha_composite(trace, (round(cx + offset[0] - 64),
                                       round(cy + offset[1] - 112)))

    placements = [
        ((1, 1), "street_housing_jars", (-32, -4)),
        ((2, 1), "street_housing_firewood", (31, 5)),
        ((4, 1), "street_agri_produce_baskets", (-28, 8)),
        ((5, 2), "street_agri_handcart", (28, -9)),
        ((1, 4), "street_gold_sealed_crates", (-29, 9)),
        ((2, 5), "street_gold_notice_board", (28, -8)),
        ((4, 5), "street_energy_pipe_stack", (-30, -5)),
        ((5, 4), "street_energy_gear_crate", (30, 7)),
        ((0, 3), "street_fixture_lantern", (-34, -5)),
        ((3, 6), "street_fixture_water_pump", (34, 5)),
        ((6, 2), "street_fixture_bench", (-34, -5)),
    ]
    sortable = []
    for cell, name, offset in placements:
        cx, cy = centers[cell]
        sortable.append((cy + offset[1], cx + offset[0], name))
    for foot_y, foot_x, name in sorted(sortable):
        prop = Image.open(SOURCE / "props" / f"{name}.png").convert("RGBA")
        prop = prop.resize((128, 128), Image.Resampling.LANCZOS)
        canvas.alpha_composite(prop, (round(foot_x - 64), round(foot_y - 112)))
    return canvas


def compose_edge_preview(atlas, manifest):
    canvas = checker((1024, 320), 20)
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    road = atlas.crop((0, 0, 128, 64)).resize((240, 120), Image.Resampling.NEAREST)
    for index, name in enumerate(manifest.get("edges", [])):
        x = (index % 4) * 256 + 8
        y = (index // 4) * 152 + 18
        canvas.alpha_composite(road, (x, y))
        edge = Image.open(EDGE_CANDIDATES / f"{name}.png").convert("RGBA")
        edge = edge.resize((240, 120), Image.Resampling.NEAREST)
        canvas.alpha_composite(edge, (x, y))
        draw.text((x, y + 122), name, fill=(244, 236, 214, 255), font=font)
    return canvas


def compose_dynamic_preview(atlas):
    canvas = checker((1024, 420), 20)
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    road = atlas.crop((0, 0, 128, 64))
    panels = [(24, "DAY / DRY", "street_fixture_lantern"),
              (524, "NIGHT / RAIN", "street_fixture_lantern_lit")]
    for panel_x, title, lantern_name in panels:
        draw.rectangle((panel_x, 28, panel_x + 476, 388),
                       fill=(68, 64, 56, 255) if panel_x < 500 else (31, 38, 48, 255),
                       outline=(141, 129, 104, 255), width=2)
        draw.text((panel_x + 12, 40), title, fill=(244, 228, 188, 255), font=font)
        centers = []
        for i in range(4):
            for j in range(4):
                cx = panel_x + 238 + (i - j) * 62
                cy = 110 + (i + j) * 31
                centers.append((cx, cy))
                canvas.alpha_composite(road, (cx - 64, cy - 32))
        if panel_x > 500:
            for index, center_index in enumerate((2, 5, 8, 11)):
                cx, cy = centers[center_index]
                puddle = Image.open(
                    SOURCE / "props" / f"street_weather_puddle_{index}.png"
                ).convert("RGBA").resize((128, 128), Image.Resampling.LANCZOS)
                puddle.putalpha(puddle.getchannel("A").point(lambda value: round(value * 0.68)))
                canvas.alpha_composite(puddle, (cx - 64, cy - 112))
        foot_x, foot_y = centers[4]
        lantern = Image.open(SOURCE / "props" / f"{lantern_name}.png").convert("RGBA")
        lantern = lantern.resize((128, 128), Image.Resampling.LANCZOS)
        canvas.alpha_composite(lantern, (foot_x - 64, foot_y - 112))
    draw.text((24, 399),
              "SAME ORTHO 30deg CAMERA / MODELED NIGHT SWAP + FOUR MODELED PUDDLE VARIANTS",
              fill=(228, 218, 196, 255), font=font)
    return canvas


def main():
    install = "--install" in sys.argv[1:]
    manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))

    frames = []
    reports = []
    for name in manifest["roads"]:
        path = SOURCE / "road_frames" / f"{name}.png"
        image = Image.open(path).convert("RGBA").resize((128, 64), Image.Resampling.LANCZOS)
        image = clear_low_alpha(image)
        frames.append(image)
    atlas = Image.new("RGBA", (128 * len(frames), 64), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        atlas.alpha_composite(frame, (index * 128, 0))
    atlas_candidate = SOURCE / "building_road_tiles_candidate.png"
    atlas.save(atlas_candidate, optimize=True)
    reports.append(alpha_bbox_report(atlas_candidate))

    for name in manifest["props"]:
        source = SOURCE / "props" / f"{name}.png"
        reports.append(alpha_bbox_report(source))

    EDGE_CANDIDATES.mkdir(parents=True, exist_ok=True)
    for name in manifest.get("edges", []):
        source = SOURCE / "edge_frames" / f"{name}.png"
        image = Image.open(source).convert("RGBA").resize((128, 64), Image.Resampling.LANCZOS)
        image = clear_low_alpha(image)
        candidate = EDGE_CANDIDATES / f"{name}.png"
        image.save(candidate, optimize=True)
        reports.append(alpha_bbox_report(candidate))

    width = 1024
    road_panel_h = 150
    prop_cell = 256
    rows = (len(manifest["props"]) + 3) // 4
    sheet = checker((width, road_panel_h + rows * prop_cell), 20)
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    road_preview = atlas.resize((width, 42), Image.Resampling.LANCZOS)
    sheet.alpha_composite(road_preview, (0, 32))
    draw.text((12, 10), "MODELED ROAD VARIANTS - ORTHO 30deg / ROOT 44.8deg", fill=(235, 220, 182, 255), font=font)
    draw.text((12, 84),
              f"{len(manifest['props'])} MODELED STREET ASSETS - PROPS / SURFACE TRACES / FIXTURES",
              fill=(235, 220, 182, 255), font=font)

    for index, name in enumerate(manifest["props"]):
        image = Image.open(SOURCE / "props" / f"{name}.png").convert("RGBA")
        x = (index % 4) * prop_cell
        y = road_panel_h + (index // 4) * prop_cell
        sheet.alpha_composite(image, (x, y))
        draw.rectangle((x + 4, y + 4, x + 252, y + 252), outline=(120, 126, 130, 120), width=1)
        draw.text((x + 8, y + 232), name, fill=(244, 236, 214, 255), font=font)

    preview = SOURCE / "world122_street_decor_preview.png"
    sheet.save(preview, optimize=True)
    layout_preview = SOURCE / "world122_street_layout_preview.png"
    compose_layout_preview(atlas, manifest).save(layout_preview, optimize=True)
    edge_preview = SOURCE / "world122_street_edge_preview.png"
    compose_edge_preview(atlas, manifest).save(edge_preview, optimize=True)
    dynamic_preview = SOURCE / "world122_street_dynamic_preview.png"
    compose_dynamic_preview(atlas).save(dynamic_preview, optimize=True)
    (SOURCE / "asset-report.json").write_text(
        json.dumps({
            "assets": reports,
            "preview": str(preview.relative_to(REPO)).replace("\\", "/"),
            "layoutPreview": str(layout_preview.relative_to(REPO)).replace("\\", "/"),
            "edgePreview": str(edge_preview.relative_to(REPO)).replace("\\", "/"),
            "dynamicPreview": str(dynamic_preview.relative_to(REPO)).replace("\\", "/"),
        },
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if install:
        PROP_ASSETS.mkdir(parents=True, exist_ok=True)
        EDGE_ASSETS.mkdir(parents=True, exist_ok=True)
        shutil.copy2(atlas_candidate, ASSETS / "building_road_tiles.png")
        for name in manifest["props"]:
            shutil.copy2(SOURCE / "props" / f"{name}.png", PROP_ASSETS / f"{name}.png")
        for name in manifest.get("edges", []):
            shutil.copy2(EDGE_CANDIDATES / f"{name}.png", EDGE_ASSETS / f"{name}.png")
        print(f"Installed {len(frames)} road frames, {len(manifest['props'])} props "
              f"and {len(manifest.get('edges', []))} road edges; preview={preview}")
    else:
        print(f"Prepared candidate preview without runtime install: {preview}")


if __name__ == "__main__":
    main()
