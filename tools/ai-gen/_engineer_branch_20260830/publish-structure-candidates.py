"""Lay out unchanged full raw candidates for user selection; no cutout or image editing."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
manifest = json.loads((ROOT / "candidate-manifest.json").read_text(encoding="utf-8"))
REPO = ROOT.parents[2]
OUT = ROOT / "previews"
OUT.mkdir(exist_ok=True)
FONT = "C:/Windows/Fonts/msyh.ttc"
def font(size):
    return ImageFont.truetype(FONT, size)
all_rows = []
entries = []
for asset in manifest["assets"]:
    row = Image.new("RGB", (1800, 712), "#eeeae1")
    draw = ImageDraw.Draw(row)
    draw.text((24, 13), f"LV{asset['level']}  {asset['label']} · 12步结构候选", font=font(30), fill="#253635")
    draw.text((1050, 19), f"建议方向 {asset['suggestedCandidate']:02d} · 有偏差待修正，未定稿", font=font(24), fill="#805724")
    for variant in range(1, 4):
        stem = f"{asset['id']}_structure_v{variant:02d}"
        source = REPO / asset.get("reviewOutputRoot", manifest["outputRoot"]) / asset["id"] / (stem + "_raw.png")
        generation = source.with_name(stem + "_generation.json")
        meta = json.loads(generation.read_text(encoding="utf-8"))
        picture = Image.open(source).convert("RGB")
        picture.thumbnail((570, 570), Image.Resampling.LANCZOS)
        left = (variant - 1) * 600
        row.paste(picture, (left + (600 - picture.width) // 2, 70 + (570 - picture.height) // 2))
        draw.text((left + 20, 651), f"候选 {variant:02d}   seed {meta['seed']}", font=font(25), fill="#253635")
        entries.append({"assetId": asset["id"], "level": asset["level"], "candidate": variant,
                        "raw": str(source.relative_to(ROOT)).replace("\\", "/"),
                        "metadata": str(generation.relative_to(ROOT)).replace("\\", "/"),
                        "seed": meta["seed"], "selected": False,
                        "suggestedDirection": variant == asset["suggestedCandidate"],
                        "review": "structure-review.md",
                        "refineReady": False})
    row.save(OUT / (asset["id"] + "-structure-candidates.png"))
    all_rows.append(row)
sheet = Image.new("RGB", (1800, 3 * 712 + 82), "#eeeae1")
for index, row in enumerate(all_rows):
    sheet.paste(row, (0, index * 712))
draw = ImageDraw.Draw(sheet)
draw.text((24, 2149), "完整绿底 raw · 尚未选稿 · 未做48步精修 / 抠图 / 入库", font=font(26), fill="#526663")
sheet.save(OUT / "engineer-branch-structure-candidates-s12.png")
(ROOT / "candidate-index.json").write_text(json.dumps({
    "stage": "structure", "approvalStatus": "awaiting_user_selection",
    "preview": "previews/engineer-branch-structure-candidates-s12.png",
    "entries": entries
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(OUT / "engineer-branch-structure-candidates-s12.png")
