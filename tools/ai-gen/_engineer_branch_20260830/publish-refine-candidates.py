"""Arrange full raw sources and 48-step outputs for review; no image retouching."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
MANIFEST = ROOT / "candidate-manifest-refine-v1.json"
manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
out = ROOT / "previews"
out.mkdir(exist_ok=True)
font = lambda size: ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", size)
rows, entries = [], []
for asset in manifest["assets"]:
    row = Image.new("RGB", (1800, 744), "#eeeae1")
    draw = ImageDraw.Draw(row)
    draw.text((24, 12), f"LV{asset['level']}  {asset['label']} · 原图与48步精修", font=font(30), fill="#253635")
    source = REPO / asset["selectedStructureImage"]
    sources = [(source, f"已选12步 · 候选{asset['selectedStructureCandidate']:02d}", "结构与色彩对照")]
    for variant in (1, 2):
        stem = f"{asset['id']}_refine_v{variant:02d}"
        raw = REPO / manifest["outputRoot"] / asset["id"] / (stem + "_raw.png")
        meta_path = raw.with_name(stem + "_generation.json")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        sources.append((raw, f"48步 · 候选{variant:02d}   seed {meta['seed']}", "待选稿 · 不代表已修正全部偏差"))
        entries.append({"assetId": asset["id"], "level": asset["level"], "candidate": variant,
                        "raw": raw.relative_to(ROOT).as_posix(),
                        "metadata": meta_path.relative_to(ROOT).as_posix(),
                        "sourceStructure": source.relative_to(ROOT).as_posix(),
                        "seed": meta["seed"], "selected": False,
                        "review": "refine-review.md"})
    for col, (path, caption, subtitle) in enumerate(sources):
        picture = Image.open(path).convert("RGB")
        picture.thumbnail((570, 570), Image.Resampling.LANCZOS)
        left = col * 600
        row.paste(picture, (left + (600 - picture.width) // 2, 70 + (570 - picture.height) // 2))
        draw.text((left + 18, 651), caption, font=font(24), fill="#253635")
        draw.text((left + 18, 692), subtitle, font=font(22), fill="#805724")
    row.save(out / f"{asset['id']}-refine-comparison.png")
    rows.append(row)
sheet = Image.new("RGB", (1800, 3 * 744 + 76), "#eeeae1")
for i, row in enumerate(rows):
    sheet.paste(row, (0, i * 744))
ImageDraw.Draw(sheet).text((24, 2251), "48步 / Depth 0.75 / denoise 0.30 · 完整raw · 未抠图、未入库", font=font(26), fill="#526663")
sheet.save(out / "engineer-branch-refine-candidates-s48.png")

def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

save(ROOT / "refine-candidate-index.json", {
    "stage": "refine", "approvalStatus": "awaiting_user_selection",
    "preview": "previews/engineer-branch-refine-candidates-s48.png", "entries": entries
})
base_path = ROOT / "candidate-manifest.json"
base = json.loads(base_path.read_text(encoding="utf-8"))
base["status"] = "structure_selected_refine_candidates_complete"
base["refineManifest"] = MANIFEST.name
for asset in base["assets"]:
    refined = next(a for a in manifest["assets"] if a["id"] == asset["id"])
    asset["selectionStatus"] = "user_selected_for_standard_refine_with_known_deviations"
    asset["selectedStructureImage"] = refined["selectedStructureImage"]
save(base_path, base)
index_path = ROOT / "candidate-index.json"
index = json.loads(index_path.read_text(encoding="utf-8"))
index["approvalStatus"] = "user_selected_recommended_03_01_03_for_48_steps"
index["refineIndex"] = "refine-candidate-index.json"
for entry in index["entries"]:
    asset = next(a for a in manifest["assets"] if a["id"] == entry["assetId"])
    entry["selected"] = entry["candidate"] == asset["selectedStructureCandidate"]
    entry["refineReady"] = entry["selected"]
    entry["approvalScope"] = "48-step candidate generation only; known deviations remain subject to review" if entry["selected"] else None
save(index_path, index)
print(out / "engineer-branch-refine-candidates-s48.png")
