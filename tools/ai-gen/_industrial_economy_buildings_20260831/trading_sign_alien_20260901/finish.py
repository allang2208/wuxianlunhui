"""Keep source02 byte-for-byte outside the requested sign mask; present the edit."""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
source_path = REPO / manifest["correctionRun"]["sourceImage"]
generated_path = HERE / "trading_company/trading_company_refine_v01_raw.png"
source = Image.open(source_path).convert("RGB")
generated = Image.open(generated_path).convert("RGB")
mask = Image.open(HERE / "sign-mask.png").convert("L")
if source.size != generated.size or source.size != mask.size:
    raise SystemExit("Source, generated image and sign mask must share the same full canvas")
final = Image.composite(generated, source, mask)
output = HERE / "trading_company_alien_sign_raw.png"
final.save(output)

source_array = np.asarray(source)
output_array = np.asarray(final)
mask_array = np.asarray(mask)
changed = np.any(source_array != output_array, axis=2)
ys, xs = np.where(changed)
provenance = {
    "source": source_path.relative_to(REPO).as_posix(),
    "generatedImage": generated_path.relative_to(REPO).as_posix(),
    "output": output.relative_to(REPO).as_posix(),
    "mask": (HERE / "sign-mask.png").relative_to(REPO).as_posix(),
    "operation": "PIL.Image.composite generated sign over immutable source02 using the authored sign-face mask",
    "changedPixelCount": int(changed.sum()),
    "changedBBox": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1] if len(xs) else None,
    "outsideMaskChangedPixels": int(np.count_nonzero(changed & (mask_array == 0))),
    "sourceMode": source.mode, "outputMode": final.mode, "size": list(final.size),
    "transparentFinishingPerformed": False, "runtimeInstalled": False,
    "sourceOutsideSignRestoredExactly": True,
    "generationMetadata": "trading_company/trading_company_refine_v01_generation.json"
}
(HERE / "provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

font_path = "C:/Windows/Fonts/msyh.ttc"
board = Image.new("RGB", (1200, 850), (239, 242, 246))
draw = ImageDraw.Draw(board)
draw.text((24, 15), "贸易公司02 · 招牌异形文字修订", font=ImageFont.truetype(font_path, 28), fill=(24, 34, 48))
draw.text((24, 54), "只修改黑色牌面 · 保留02原有建筑、门廊与货仓布局", font=ImageFont.truetype(font_path, 19), fill=(77, 88, 101))
board.paste(final.resize((752, 752), Image.Resampling.LANCZOS), (16, 86))
crop = (710, 583, 795, 664)
for image, title, y in [(source, "修改前", 110), (final, "异形文字", 496)]:
    draw.text((818, y - 34), title, font=ImageFont.truetype(font_path, 22), fill=(24, 34, 48))
    board.paste(image.crop(crop).resize((340, 324), Image.Resampling.LANCZOS), (818, y))
board.save(HERE / "comparison.png")
final.crop((698, 569, 808, 673)).resize((660, 624), Image.Resampling.LANCZOS).save(HERE / "edited-sign-detail.png")
print(json.dumps(provenance, ensure_ascii=False))
