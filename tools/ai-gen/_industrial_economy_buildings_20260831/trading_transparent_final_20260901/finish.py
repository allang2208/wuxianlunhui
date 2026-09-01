"""Reproduce the selected trading-company cutout; no generation or runtime install."""
from pathlib import Path
import json
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
BATCH = HERE.parent / "trading_refinement_dev_s48_20260901"
SOURCE_MANIFEST = json.loads((BATCH / "manifest.json").read_text(encoding="utf-8"))
SOURCE = BATCH / "trading_company/trading_company_refine_v01_sign_preserved.png"
FONT_PATH = "C:/Windows/Fonts/msyh.ttc"
THRESHOLD = 100


def relative(path):
    return Path(path).resolve().relative_to(REPO).as_posix()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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


def paste_center(canvas, image, area):
    x, y, w, h = area
    thumb = image.copy()
    thumb.thumbnail((w, h), Image.Resampling.LANCZOS)
    canvas.paste(thumb, (x + (w - thumb.width) // 2, y + (h - thumb.height) // 2), thumb)


def main():
    folder = HERE / "trading_company"
    folder.mkdir(exist_ok=True)
    keyed = folder / "keyed.png"
    clean = folder / "edge-clean.png"
    final = folder / "trading_company.png"
    metadata = folder / "export-metadata.json"
    commands = [run("key-world122-building-body.py", relative(SOURCE), relative(keyed),
                    "--threshold", THRESHOLD)]
    commands.append(run("repair-local-green-spill.py", relative(keyed), relative(clean),
                        "--rect", "0,0,1024,1024", "--max-edge-distance", 2,
                        "--min-green", 80, "--green-margin", 30))
    commands.append(run("finalize-building-runtime.py", relative(clean), relative(final),
                        "--display-width", 512, "--padding", 4,
                        "--preserve-alpha-exact", "--nearest-opaque-edge-rgb",
                        "--metadata", relative(metadata)))

    export = json.loads(metadata.read_text(encoding="utf-8"))
    source_rgb = np.asarray(Image.open(SOURCE).convert("RGB"))
    key_rgb = np.median(np.vstack([source_rgb[:12, :12].reshape(-1, 3),
                                  source_rgb[:12, -12:].reshape(-1, 3),
                                  source_rgb[-12:, :12].reshape(-1, 3),
                                  source_rgb[-12:, -12:].reshape(-1, 3)]), axis=0).tolist()
    keyed_rgba = np.asarray(Image.open(keyed).convert("RGBA"))
    clean_rgba = np.asarray(Image.open(clean).convert("RGBA"))
    final_image = Image.open(final).convert("RGBA")
    final_rgba = np.asarray(final_image)
    x0, y0, x1, y1 = export["cropBox"]
    labels, component_count = ndimage.label(final_rgba[..., 3] >= 16)
    component_sizes = np.bincount(labels.ravel())[1:]
    nonzero_components = [int(v) for v in sorted(component_sizes.tolist(), reverse=True) if v]
    delivery = {
        "id": "trading_company", "label": "贸易公司", "selected48Variant": 1,
        "seed": 133251, "source": relative(SOURCE),
        "sourceIsSignPreservedDerivative": True,
        "sourceSignPreservationProvenance": relative(BATCH / "sign-preservation-provenance.json"),
        "source48Raw": relative(BATCH / "trading_company/trading_company_refine_v01_raw.png"),
        "sourceGenerationMetadata": relative(BATCH / "trading_company/trading_company_refine_v01_generation.json"),
        "source48Manifest": relative(BATCH / "manifest.json"),
        "sourceModel": SOURCE_MANIFEST["assets"][0]["modelSource"],
        "sourceDepth": SOURCE_MANIFEST["assets"][0]["controlImage"],
        "measuredKeyRGB": key_rgb, "edgeConnectedKeyThreshold": THRESHOLD,
        "thresholdReviewRebuildable": relative(HERE / "threshold-review"),
        "selectedThreshold": 100,
        "removeAllGreen": False, "removeEnclosedKey": False,
        "depthAlphaPolicy": "The original full Depth has the obsolete narrow-end warehouse doorway and old sign icon. It was viewed only to reject it as an Alpha mask; it did not clip, restore or dilate the accepted source.",
        "shadowCleanup": "No separate external cast shadow was found. Only the canvas-edge-connected RGB key was removed; the warehouse interior and dark office doorway remain opaque authored pixels.",
        "edgeRepair": {"maxEdgeDistance": 2, "minGreen": 80, "greenMargin": 30,
                       "changedRGBPixels": int(np.count_nonzero(np.any(clean_rgba[..., :3] != keyed_rgba[..., :3], axis=2))),
                       "changedAlphaPixels": int(np.count_nonzero(clean_rgba[..., 3] != keyed_rgba[..., 3]))},
        "fullCanvasAlphaMaster": relative(clean), "final": relative(final),
        "metadata": relative(metadata), "cropBox": export["cropBox"],
        "fileSize": list(final_image.size), "alphaBBox": export["alphaBBox"],
        "alphaExtrema": final_image.getchannel("A").getextrema(),
        "alphaComponentCountAt16": int(component_count),
        "alphaComponentPixelsAt16Descending": nonzero_components,
        "transparentRGBNonzeroPixels": int(np.count_nonzero(np.any(final_rgba[..., :3] != 0, axis=2) & (final_rgba[..., 3] == 0))),
        "exportChangedAlphaPixels": int(np.count_nonzero(final_rgba[..., 3] != clean_rgba[y0:y1, x0:x1, 3])),
        "nominalDisplay": {"width": export["displayW"], "height": export["displayH"],
                           "footOffsetY": export["footOffsetY"], "referenceOnly": True,
                           "runtimeCalibrationPerformed": False, "pngResized": False},
        "commands": commands, "runtimeInstalled": False
    }
    write_json(folder / "provenance.json", delivery)

    board = Image.new("RGB", (1536, 610), (237, 240, 244))
    draw = ImageDraw.Draw(board)
    font_title = ImageFont.truetype(FONT_PATH, 27)
    font_sub = ImageFont.truetype(FONT_PATH, 19)
    for index, (kind, title) in enumerate([("white", "白底"), ("black", "深色底"), ("checker", "透明棋盘")]):
        board.paste(background((512, 520), kind), (index * 512, 64))
        draw.text((index * 512 + 18, 16), f"贸易公司 · {title}", font=font_title, fill=(32, 40, 50))
        paste_center(board, final_image, (index * 512 + 22, 82, 468, 482))
    draw.text((20, 586), "精修01 · 异形招牌字形保留 · 透明定稿候选 · 尚未接入游戏", font=font_sub, fill=(66, 76, 88))
    board.save(HERE / "preview.png")

    detail = Image.new("RGB", (1280, 520), (241, 243, 246))
    draw = ImageDraw.Draw(detail)
    full = Image.open(clean).convert("RGBA")
    specs = [((688, 560, 814, 688), "异形招牌 / 雨棚", 16),
             ((102, 545, 540, 910), "货仓门 / 双货箱 / 地台边", 640)]
    for crop, title, x in specs:
        draw.text((x + 14, 16), title, font=font_title, fill=(32, 40, 50))
        panel = background((610, 444), "checker")
        paste_center(panel, full.crop(crop), (18, 18, 574, 408))
        detail.paste(panel, (x, 62))
    detail.save(HERE / "details-preview.png")

    write_json(HERE / "manifest.json", {
        "status": "selected48_transparent_artwork_delivered", "date": "2026-09-01",
        "userReply": "继续", "selected48Candidate": 1,
        "approvalMeaning": "User accepted the immediately preceding recommendation refine01 and requested continuation to transparent finishing.",
        "selected48ArtApproved": True, "transparentPreviewUserReviewed": False,
        "regenerated": False, "runtimeInstalled": False, "gameplayChanged": False,
        "fullSourceAncestryRetained": True, "runtimeFootprintCalibrated": False,
        "delivery": delivery,
        "previews": [relative(HERE / "preview.png"), relative(HERE / "details-preview.png")],
        "testsAndRuntimeVerification": "Not run; user performs testing per project agreement. Offline asset production only."
    })


if __name__ == "__main__":
    main()
