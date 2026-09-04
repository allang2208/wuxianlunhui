"""Reproduce the two selected industrial building cutouts; no generation or install."""
from pathlib import Path
import json
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
BATCH = HERE.parent / "refinement_dev_s48_20260901"
SOURCE_MANIFEST = json.loads((BATCH / "manifest.json").read_text(encoding="utf-8"))
FONT_PATH = Path("C:/Windows/Fonts/msyh.ttc")
CHOICES = [
    ("oil_power_plant", "燃油发电厂", 2, 133202, 120),
    ("cannery", "罐头加工厂", 1, 133211, 80),
]


def relative(path):
    return Path(path).resolve().relative_to(REPO).as_posix()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def font(size):
    return ImageFont.truetype(str(FONT_PATH), size)


def run(script, *args):
    command = [sys.executable, "-B", str(REPO / "tools/ai-gen" / script), *map(str, args)]
    result = subprocess.run(command, cwd=REPO, text=True, capture_output=True, check=True)
    print(result.stdout.strip(), flush=True)
    return {"tool": "tools/ai-gen/" + script, "args": list(map(str, args)),
            "stdout": result.stdout.strip(), "stderr": result.stderr.strip()}


def background(size, kind):
    if kind != "checker":
        return Image.new("RGB", size, (18, 20, 26) if kind == "black" else (248, 248, 246))
    yy, xx = np.indices((size[1], size[0]))
    tiles = ((xx // 24 + yy // 24) % 2)[..., None]
    return Image.fromarray(np.where(tiles, [188, 193, 198], [218, 221, 224]).astype(np.uint8))


def fit(image, size):
    result = image.copy()
    result.thumbnail(size, Image.Resampling.LANCZOS)
    return result


def paste_center(canvas, image, area):
    x, y, w, h = area
    thumb = fit(image, (w, h))
    canvas.paste(thumb, (x + (w - thumb.width) // 2, y + (h - thumb.height) // 2), thumb)


def main():
    deliveries = []
    final_images = []
    for asset_id, label, variant, seed, threshold in CHOICES:
        asset = next(item for item in SOURCE_MANIFEST["assets"] if item["id"] == asset_id)
        raw = BATCH / asset_id / f"{asset_id}_refine_v{variant:02d}_raw.png"
        folder = HERE / asset_id
        folder.mkdir(exist_ok=True)
        keyed = folder / "keyed.png"
        clean = folder / "edge-clean.png"
        final = folder / f"{asset_id}.png"
        metadata = folder / "export-metadata.json"
        commands = [run("key-world122-building-body.py", relative(raw), relative(keyed),
                        "--threshold", threshold)]
        # Two-pixel boundary only. Interior green glazing, roof and produce are excluded.
        first_clean = folder / "edge-clean-initial.png" if asset_id == "oil_power_plant" else clean
        commands.append(run("repair-local-green-spill.py", relative(keyed), relative(first_clean),
                            "--rect", "0,0,1024,1024", "--max-edge-distance", 2,
                            "--min-green", 90, "--green-margin", 35))
        foundation_pass = None
        if asset_id == "oil_power_plant":
            # Shadow-darkened green is below G=90 along this plinth edge only.
            foundation_pass = {"rect": [504, 708, 961, 934], "maxEdgeDistance": 4,
                               "minGreen": 20, "greenMargin": 15}
            commands.append(run("repair-local-green-spill.py", relative(first_clean), relative(clean),
                                "--rect", "504,708,961,934", "--max-edge-distance", 4,
                                "--min-green", 20, "--green-margin", 15))
        commands.append(run("finalize-building-runtime.py", relative(clean), relative(final),
                            "--display-width", 512, "--padding", 4,
                            "--preserve-alpha-exact", "--nearest-opaque-edge-rgb",
                            "--metadata", relative(metadata)))

        export = json.loads(metadata.read_text(encoding="utf-8"))
        rgba_image = Image.open(final).convert("RGBA")
        rgba = np.asarray(rgba_image)
        raw_rgb = np.asarray(Image.open(raw).convert("RGB"))
        key_rgb = np.median(np.vstack([raw_rgb[:12, :12].reshape(-1, 3),
                                      raw_rgb[:12, -12:].reshape(-1, 3),
                                      raw_rgb[-12:, :12].reshape(-1, 3),
                                      raw_rgb[-12:, -12:].reshape(-1, 3)]), axis=0).tolist()
        x0, y0, x1, y1 = export["cropBox"]
        clean_rgba = np.asarray(Image.open(clean).convert("RGBA"))
        keyed_rgba = np.asarray(Image.open(keyed).convert("RGBA"))
        delivery = {
            "id": asset_id, "label": label, "selected48Variant": variant, "seed": seed,
            "sourceRaw": relative(raw),
            "sourceGenerationMetadata": relative(raw.with_name(raw.name.replace("_raw.png", "_generation.json"))),
            "source48Manifest": relative(BATCH / "manifest.json"),
            "previousAcceptedInput": asset["acceptedRefinementInput"],
            "sourceModel": asset["modelSource"], "sourceDepth": asset["controlImage"],
            "measuredKeyRGB": key_rgb, "edgeConnectedKeyThreshold": threshold,
            "removeAllGreen": False, "removeEnclosedKey": False,
            "depthAlphaPolicy": "Full Depth viewed for structure reference only. Selected raw has accepted roof, plinth and equipment contour differences; no Depth mask, dilation or alpha restoration.",
            "shadowCleanup": "Edge-connected RGB key removed exterior backdrop and cast shadow; no broad HSV, outside polygon or alpha-hole filling needed.",
            "edgeRepair": {"maxEdgeDistance": 2, "minGreen": 90, "greenMargin": 35,
                           "additionalFoundationPass": foundation_pass,
                           "changedRGBPixels": int(np.count_nonzero(np.any(clean_rgba[..., :3] != keyed_rgba[..., :3], axis=2))),
                           "changedAlphaPixels": int(np.count_nonzero(clean_rgba[..., 3] != keyed_rgba[..., 3]))},
            "final": relative(final), "fullCanvasAlphaMaster": relative(clean),
            "metadata": relative(metadata), "cropBox": export["cropBox"],
            "fileSize": list(rgba_image.size), "alphaBBox": export["alphaBBox"],
            "alphaExtrema": rgba_image.getchannel("A").getextrema(),
            "transparentRGBNonzeroPixels": int(np.count_nonzero(np.any(rgba[..., :3] != 0, axis=2) & (rgba[..., 3] == 0))),
            "exportChangedAlphaPixels": int(np.count_nonzero(rgba[..., 3] != clean_rgba[y0:y1, x0:x1, 3])),
            "nominalDisplay": {"width": export["displayW"], "height": export["displayH"],
                               "footOffsetY": export["footOffsetY"], "referenceOnly": True,
                               "runtimeCalibrationPerformed": False, "pngResized": False},
            "commands": commands,
        }
        write_json(folder / "provenance.json", delivery)
        deliveries.append(delivery)
        final_images.append(rgba_image)

        board = Image.new("RGB", (1536, 530), (237, 240, 244))
        draw = ImageDraw.Draw(board)
        for i, (kind, title) in enumerate([("white", "白底"), ("black", "深色底"), ("checker", "透明棋盘")]):
            board.paste(background((512, 468), kind), (i * 512, 62))
            draw.text((i * 512 + 20, 17), f"{label} · {title}", font=font(23), fill=(32, 40, 50))
            paste_center(board, rgba_image, (i * 512 + 20, 78, 472, 438))
        board.save(folder / "background-preview.png")

    board = Image.new("RGB", (1280, 654), (241, 243, 246))
    draw = ImageDraw.Draw(board)
    draw.text((30, 19), "近代经济建筑 · 透明定稿", font=font(29), fill=(27, 35, 46))
    draw.text((30, 64), "燃油48步02 / 罐头48步01 · 保留所选造型与配色 · 尚未接入游戏", font=font(19), fill=(78, 87, 99))
    for i, ((_, label, _, _, _), final) in enumerate(zip(CHOICES, final_images)):
        board.paste(background((606, 488), "checker"), (20 + i * 634, 114))
        paste_center(board, final, (35 + i * 634, 132, 576, 454))
        draw.text((32 + i * 634, 615), label, font=font(23), fill=(27, 35, 46))
    board.save(HERE / "preview.png")

    details = Image.new("RGB", (1280, 550), (243, 245, 247))
    draw = ImageDraw.Draw(details)
    detail_specs = [(0, (182, 236, 287, 737), "爬梯 / 敞口烟囱", (18, 61, 210, 470)),
                    (1, (572, 476, 847, 801), "立体门标 / 输送线 / 果蔬", (247, 61, 460, 470)),
                    (1, (304, 588, 500, 825), "管线 / 杀菌釜", (726, 61, 536, 470))]
    for index, crop, title, area in detail_specs:
        source = Image.open(HERE / CHOICES[index][0] / "edge-clean.png").convert("RGBA").crop(crop)
        x, y, w, h = area
        details.paste(background((w, h), "checker"), (x, y))
        draw.text((x, 21), title, font=font(20), fill=(34, 44, 56))
        paste_center(details, source, area)
    details.save(HERE / "details-preview.png")

    write_json(HERE / "manifest.json", {
        "status": "selected48_transparent_artwork_delivered", "date": "2026-09-01",
        "userReply": "按你建议继续", "selected48Candidates": {"oil_power_plant": 2, "cannery": 1},
        "approvalMeaning": "User accepted the immediately preceding recommendation oil02/cannery01 and requested transparent finishing.",
        "selected48ArtApproved": True, "transparentPreviewUserReviewed": False,
        "regenerated": False, "runtimeInstalled": False, "gameplayChanged": False,
        "tradingCompanyChanged": False, "fullSourceAncestryRetained": True,
        "runtimeFootprintCalibrated": False, "deliveries": deliveries,
        "previews": [relative(HERE / "preview.png"), relative(HERE / "details-preview.png")],
        "testsAndRuntimeVerification": "Not run; user performs testing per project agreement. Offline asset production only.",
    })


if __name__ == "__main__":
    main()
