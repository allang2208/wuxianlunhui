"""Prepare seven industrial badges with the existing technology-icon exporter.

Does not generate or repaint subjects. The optional --install step only copies
the prepared PNGs and changes the seven existing technology iconPath fields.
"""
import argparse
import json
import shutil
import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true")
    args = parser.parse_args()
    source_manifest = json.loads((ROOT / "sources.json").read_text(encoding="utf-8"))
    entries = source_manifest["entries"]
    source = ROOT.parent / "_technology_tree_gap_icons_20260826/finalize_icons.py"
    spec = spec_from_file_location("industrial_badge_export", source)
    shared = module_from_spec(spec)
    spec.loader.exec_module(shared)
    final_dir = ROOT / "final"
    final_dir.mkdir(exist_ok=True)
    outputs = []
    for entry in entries:
        raw = Image.open(ROOT / entry["sourceRaw"])
        bounds = shared.find_badge_bounds(raw, entry["backgroundMode"])
        icon = shared.normalize(shared.cut_hex_badge(raw, entry["backgroundMode"]))
        icon.save(ROOT / entry["finalPath"], optimize=True)
        entry.update({"rawSize": list(raw.size), "rawMode": raw.mode,
                      "hexBounds": list(bounds), "finalSize": list(icon.size),
                      "finalMode": icon.mode, "alphaBounds": list(icon.getbbox())})
        outputs.append(icon)

    # Authoring board only; no game/browser/runtime verification.
    board = Image.new("RGB", (1600, 1060), "#e6e7e7")
    draw = ImageDraw.Draw(board)
    title = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 28)
    label = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 21)
    note = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 16)
    draw.text((28, 18), "近代科技图标 · 七项配套徽章", font=title, fill="#243139")
    for i, (entry, icon) in enumerate(zip(entries, outputs)):
        x, y = (i % 4) * 400, 72 + (i // 4) * 480
        draw.rectangle((x+10, y, x+389, y+369), fill="#29343e")
        thumb = icon.resize((366, 366), Image.Resampling.LANCZOS)
        board.paste(thumb, (x+17, y+2), thumb)
        draw.text((x+22, y+377), entry["name"], font=label, fill="#26323a")
        for j, size in enumerate((64, 48)):
            small = icon.resize((size, size), Image.Resampling.LANCZOS)
            xx = x+22+j*150
            board.paste(small, (xx, y+409), small)
            draw.text((xx+size+8, y+426), str(size)+"px", font=note, fill="#53616a")
    board.save(ROOT / "industrial-technology-icons-preview.png")

    if args.install:
        data_path = PROJECT / "data/technology-tree.json"
        text = data_path.read_bytes().decode("utf-8")
        for entry in entries:
            old = '"iconPath": "' + entry["previousIconPath"] + '"'
            new = '"iconPath": "' + entry["runtimePath"] + '"'
            if old in text:
                if text.count(old) != 1:
                    raise RuntimeError("ambiguous iconPath: " + entry["id"])
                text = text.replace(old, new, 1)
            elif new not in text:
                raise RuntimeError("iconPath changed since preparation: " + entry["id"])
        for entry in entries:
            destination = PROJECT / entry["runtimePath"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists() and destination.read_bytes() != (ROOT / entry["finalPath"]).read_bytes():
                raise RuntimeError("refusing to overwrite different existing icon: " + str(destination))
            shutil.copy2(ROOT / entry["finalPath"], destination)
        data_path.write_bytes(text.encode("utf-8"))

    manifest = {
        "date": "2026-08-31", "generator": "Codex built-in image_gen",
        "promptSet": "prompts.json", "sourceRecords": "sources.json",
        "exporter": str(source.relative_to(PROJECT)).replace("\\", "/"),
        "operation": "Existing hexagonal alpha mask and 1024px normalization; no subject repaint",
        "installed": args.install, "runtimeTested": False,
        "rankMarkers": "Three generated crystals in each industrial tier III badge; existing modern icons unchanged",
        "entries": entries,
    }
    (ROOT / "generation-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print("Prepared", len(entries), "icons; installed:", args.install)


if __name__ == "__main__":
    main()
