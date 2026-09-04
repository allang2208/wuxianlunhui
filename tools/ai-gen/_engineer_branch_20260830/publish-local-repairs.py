"""Publish only visually chosen local-repair variants beside their selected sources."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
manifest = json.loads((ROOT / "candidate-manifest-local-v1.json").read_text(encoding="utf-8"))
selection = json.loads((ROOT / "local-review-selection.json").read_text(encoding="utf-8"))
out = ROOT / "previews"
font = lambda size: ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", size)
rows, entries = [], []
lineup = Image.new("RGB", (1800, 726), "#eeeae1")
for i, asset in enumerate(manifest["assets"]):
    choice = selection[asset["id"]]
    stem = f"{asset['id']}_refine_v{choice['candidate']:02d}"
    folder = ROOT / "local_repair_v1" / asset["id"]
    source_path = REPO / asset["selectedRefineImage"]
    repaired_path = ROOT / choice["finishedRaw"] if choice.get("finishedRaw") else folder / (stem + "_local_raw.png")
    row = Image.new("RGB", (1600, 894), "#eeeae1")
    draw = ImageDraw.Draw(row)
    draw.text((24, 12), f"LV{asset['level']}  {asset['label']} · 局部修正前后", font=font(30), fill="#253635")
    for col, path in enumerate((source_path, repaired_path)):
        picture = Image.open(path).convert("RGB")
        picture.thumbnail((760, 760), Image.Resampling.LANCZOS)
        row.paste(picture, (col * 800 + 20, 65))
        caption = f"已选48步原图 {asset['selectedRefineCandidate']:02d}" if col == 0 else f"局部修正版 {choice['candidate']:02d} · 待确认"
        draw.text((col * 800 + 24, 844), caption, font=font(27), fill="#253635")
    row.save(out / f"{asset['id']}-local-repair-comparison.png")
    rows.append(row)
    picture = Image.open(repaired_path).convert("RGB")
    picture.thumbnail((570, 570), Image.Resampling.LANCZOS)
    lineup.paste(picture, (i * 600 + 15, 68))
    ld = ImageDraw.Draw(lineup)
    ld.text((i * 600 + 18, 17), f"LV{asset['level']}  {asset['label']}", font=font(30), fill="#253635")
    ld.text((i * 600 + 18, 658), f"源稿 {asset['selectedRefineCandidate']:02d} · 局部修正后，待确认", font=font(25), fill="#805724")
    entries.append({
        "assetId": asset["id"], "level": asset["level"], "candidate": choice["candidate"],
        "source48": source_path.relative_to(ROOT).as_posix(),
        "correctedRaw": repaired_path.relative_to(ROOT).as_posix(),
        "localMetadata": choice.get("finishedMetadata", (folder / (stem + "_local_metadata.json")).relative_to(ROOT).as_posix()),
        "selectionReason": choice["reason"], "knownLimitations": choice.get("knownLimitations", []),
        "acceptedForRuntime": False
    })
sheet = Image.new("RGB", (1600, len(rows) * 894 + 74), "#eeeae1")
for i, row in enumerate(rows):
    sheet.paste(row, (0, i * 894))
ImageDraw.Draw(sheet).text((24, len(rows) * 894 + 20), "修正区外保留已选原图 · 未抠图 / 未入库 / 未改变游戏配置", font=font(27), fill="#526663")
sheet.save(out / "engineer-branch-local-repair-comparison.png")
lineup.save(out / "engineer-branch-local-repair-lineup.png")

def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

save(ROOT / "local-repair-index.json", {
    "status": "local_repair_preview_awaiting_user_acceptance",
    "preview": "previews/engineer-branch-local-repair-lineup.png",
    "comparison": "previews/engineer-branch-local-repair-comparison.png",
    "entries": entries
})
manifest["status"] = "local_repair_preview_awaiting_user_acceptance"
manifest["reviewSelection"] = "local-review-selection.json"
save(ROOT / "candidate-manifest-local-v1.json", manifest)
previous_path = ROOT / "refine-candidate-index.json"
previous = json.loads(previous_path.read_text(encoding="utf-8"))
previous["approvalStatus"] = "user_selected_02_01_01_for_local_repair"
previous["localRepairIndex"] = "local-repair-index.json"
for entry in previous["entries"]:
    asset = next(a for a in manifest["assets"] if a["id"] == entry["assetId"])
    entry["selected"] = entry["candidate"] == asset["selectedRefineCandidate"]
    entry["approvalScope"] = "local repair source only; not runtime acceptance" if entry["selected"] else None
save(previous_path, previous)
print(out / "engineer-branch-local-repair-lineup.png")
