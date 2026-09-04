"""Build a review-only source03 correction with an explicit, reversible edit chain.

The complete original geometry remains the source. Only the generated assay
contents are composited; no unwanted rock or full-image regeneration is adopted.
Alpha comes from the dedicated building key/depth tools and stays unchanged here.
"""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "corrected_03A"
BASE = OUT / "source03_alpha_ready.png"
PATCH = ROOT / "corrections_03_masked_dev_s12/mining_guild/mining_guild_refine_v01_raw.png"
rgba = np.asarray(Image.open(BASE).convert("RGBA")).copy()
alpha = rgba[..., 3].copy()
rgb = rgba[..., :3].astype(np.float32)
generated = np.asarray(Image.open(PATCH).convert("RGB")).astype(np.float32)

# Use only the authored tabletop patch. All other generated changes are ignored.
assay_polygon = [(646, 687), (704, 687), (708, 726), (667, 746), (645, 731)]
patch_mask = Image.new("L", (1024, 1024))
ImageDraw.Draw(patch_mask).polygon(assay_polygon, fill=255)
patch_mask = patch_mask.filter(ImageFilter.GaussianBlur(1.25))
patch_mask.save(OUT / "assay_patch_composite_mask.png")
weight = np.asarray(patch_mask, dtype=np.float32) / 255.0
weight *= alpha / 255.0
rgb += (generated - rgb) * weight[..., None]
rgba[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
rgba[alpha == 0, :3] = 0
Image.fromarray(rgba).save(OUT / "source03_with_generated_assay.png")

# Edge-preserving RGB denoising reduces micro-grain without moving geometry,
# changing windows, making new roof rows, or altering any Alpha byte.
smoothed = cv2.bilateralFilter(rgb.astype(np.uint8), 9, 34, 5)
smoothed = cv2.bilateralFilter(smoothed, 9, 28, 4).astype(np.float32)
interior = np.clip((ndimage.distance_transform_edt(alpha > 0) - 1.0) / 3.0, 0.0, 1.0)
rgb += (smoothed - rgb) * (interior * 0.85)[..., None]
# Keep a small residual of the actual source material detail, not artificial grain.
rgb = np.clip(rgb, 0, 255)


def tone_region(rect, hue_min, hue_max, saturation_scale, value_scale):
    global rgb
    x0, y0, x1, y1 = rect
    crop = rgb[y0:y1, x0:x1] / 255.0
    hsv = cv2.cvtColor(crop.astype(np.float32), cv2.COLOR_RGB2HSV)
    local = ((hsv[..., 0] >= hue_min) & (hsv[..., 0] <= hue_max)
             & (alpha[y0:y1, x0:x1] > 0))
    # Neutral plaster beside the flag must not turn into bronze-colored flecks.
    # A gradual saturation gate and a feathered scope prevent hard color islands.
    amount = np.clip((hsv[..., 1] - 0.30) / 0.30, 0.0, 1.0) * local
    yy, xx = np.indices(amount.shape)
    border = np.minimum.reduce([xx, yy, x1 - x0 - 1 - xx, y1 - y0 - 1 - yy])
    amount *= np.clip(border / 3.0, 0.0, 1.0)
    hsv[..., 1] *= 1.0 + (saturation_scale - 1.0) * amount
    hsv[..., 2] *= 1.0 + (value_scale - 1.0) * amount
    adjusted = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB) * 255.0
    rgb[y0:y1, x0:x1][local] = adjusted[local]


color_edits = [
    {"region": "single purple pennant", "rect": [340, 403, 382, 511], "hue": [255, 320], "saturationScale": 0.40, "valueScale": 0.67},
    {"region": "violet mineral on cart rocks", "rect": [446, 695, 555, 780], "hue": [255, 325], "saturationScale": 0.48, "valueScale": 0.68},
    {"region": "violet assay mineral", "rect": [645, 684, 710, 748], "hue": [250, 325], "saturationScale": 0.40, "valueScale": 0.66},
    {"region": "crossed-pickaxe badge", "rect": [605, 525, 681, 609], "hue": [22, 65], "saturationScale": 0.48, "valueScale": 0.76},
    {"region": "horizontal winch fittings", "rect": [175, 612, 291, 717], "hue": [22, 65], "saturationScale": 0.58, "valueScale": 0.82},
    {"region": "pennant border", "rect": [343, 405, 382, 507], "hue": [22, 65], "saturationScale": 0.50, "valueScale": 0.79},
]
for edit in color_edits:
    tone_region(edit["rect"], *edit["hue"], edit["saturationScale"], edit["valueScale"])

rgba[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
rgba[..., 3] = alpha
rgba[alpha == 0, :3] = 0
candidate = Image.fromarray(rgba)
candidate.save(OUT / "mining_guild_03A_candidate.png")

# A neutral presentation is derived separately; the delivered candidate is RGBA.
ys, xs = np.indices((1024, 1024))
checks = ((xs // 32 + ys // 32) % 2)[..., None]
checker = np.where(checks, np.array([81, 88, 97]), np.array([67, 74, 83])).astype(np.uint8)
checker_image = Image.fromarray(checker).convert("RGBA")
checker_image.alpha_composite(candidate)
checker_image.convert("RGB").save(OUT / "mining_guild_03A_checker.png")

board = Image.new("RGB", (1464, 960), (27, 31, 35))
draw = ImageDraw.Draw(board)
font = "C:/Windows/Fonts/msyh.ttc"


def label(x, y, text, size=23, fill=(224, 228, 233)):
    draw.text((x, y), text, fill=fill, font=ImageFont.truetype(font, size))


label(28, 22, "矿业工会 · 03A纠偏候选", 34)
label(28, 77, "保留原03结构｜限定台面生成修正 + RGB降噪/调色 + 建筑专用抠绿", 23, (157, 171, 187))
label(28, 129, "原03 · 完整生成原图", 25)
label(746, 129, "03A · 后期纠偏版（非全图重绘）", 25)
raw = Image.open(ROOT / "candidates_dev_s12/mining_guild/mining_guild_structure_v03_raw.png").convert("RGB")
board.paste(raw.resize((690, 690), Image.Resampling.LANCZOS), (28, 177))
board.paste(checker_image.convert("RGB").resize((690, 690), Image.Resampling.LANCZOS), (746, 177))
label(28, 888, "原图、模型和全部中间输入保留；敞门、轨道、矿车、单旗与地台位置延续原03。", 23)
label(28, 926, "未进入48步定稿，未接入游戏；石缝/瓦片排列仍沿用03，尚未重做为更稀疏的大块面。", 20, (157, 171, 187))
board.save(ROOT / "mining_guild_03A_comparison.png")

record = {
    "assetId": "mining_guild", "candidateId": "03A", "status": "corrected_candidate_awaiting_user_review",
    "isDirectGenerationRaw": False, "sourceGeometry": "original selected structure 03",
    "directInputs": [str(BASE.relative_to(ROOT)), str(PATCH.relative_to(ROOT))],
    "sourceRaw": "candidates_dev_s12/mining_guild/mining_guild_structure_v03_raw.png",
    "sourceDepth": "mining_guild_body_depth.png",
    "assayPatchPolygon": assay_polygon, "assayPatchFeatherPixels": 1.25,
    "adoptedGeneratedRegion": "assay tabletop contents only; extra generated rocks and all other masked-run edits are excluded",
    "denoise": {"method": "two edge-preserving bilateral RGB passes", "passes": [[9, 34, 5], [9, 28, 4]], "blend": 0.85, "alphaEdgeProtectionPixels": 4},
    "colorEdits": color_edits,
    "colorSelection": {"saturationRamp": [0.30, 0.60], "scopeFeatherPixels": 3},
    "alphaSource": {"keyTool": "tools/ai-gen/key-world122-building-body.py", "threshold": 90, "removeEnclosedKey": True,
                    "removeAllGreen": True, "greenHueMin": 45, "greenHueMax": 80, "greenSaturationMin": 180, "greenValueMin": 20,
                    "greenScopeReason": "Source03 has no authored green material; high-saturation green is backdrop/spill only, lower-saturation gray stone and roof remain protected by the high saturation cutoff",
                    "depthTool": "tools/ai-gen/mask-world122-building-body.py", "edgePad": 12,
                    "RGBProcessingCopiesAlphaUnchanged": True},
    "candidate": "corrected_03A/mining_guild_03A_candidate.png",
    "preview": "corrected_03A/mining_guild_03A_checker.png",
    "comparison": "mining_guild_03A_comparison.png",
    "remainingLimitations": ["Source roof courses and masonry joint layout remain; this is grain/color correction, not a new broad-panel texture design", "Final user selection, 48-step finishing and runtime footprint calibration have not occurred"],
    "runtimeInstalled": False, "formal48StepRefinementStarted": False,
    "testsAndRuntimeVerification": "Not run; user performs testing per project agreement"
}
(OUT / "provenance.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(OUT / "mining_guild_03A_candidate.png")
print(ROOT / "mining_guild_03A_comparison.png")
