#!/usr/bin/env python3
"""Build compact direction/contact references for the four industrial units."""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OUTPUT = ROOT / "direction-references"

SPECS = {
    "service_rifleman": {
        "config": "data/hamster-assault-config.json",
        "actions": {
            "idle": [0, 6, 12, 18, 23],
            "walk": [0, 5, 10, 15, 19],
            "attack": [0, 10, 22, 30, 40],
            "dying": [0, 8, 15, 23, 30],
        },
    },
    "emplaced_machine_gun_crew": {
        "config": "data/hamster-heavy-machine-gunner-config.json",
        "actions": {
            "idle": [0, 6, 12, 18, 25],
            "walk": [0, 5, 11, 16, 21],
            "attack": [0, 15, 23, 39, 60],
            "dying": [0, 9, 17, 26, 34],
        },
    },
    "industrial_carbine_cavalry": {
        "config": "data/hamster-scout-rifle-skirmisher-config.json",
        "actions": {
            "idle": [0, 6, 13, 19, 25],
            "walk": [0, 5, 10, 15, 19],
            "attack": [0, 7, 14, 21, 28],
            "dying": [0, 12, 24, 36, 48],
        },
    },
    "gunpowder_explosive_lancer": {
        "config": "data/hamster-winged-hussar-config.json",
        "actions": {
            "idle": [0, 12, 24, 36, 47],
            "walk": [0, 4, 9, 13, 17],
            "attack": [0, 10, 21, 30, 38],
            "dying": [0, 10, 20, 30, 38],
        },
    },
}


def frame(sheet: Image.Image, index: int, width: int, height: int, cols: int) -> Image.Image:
    x = index % cols * width
    y = index // cols * height
    return sheet.crop((x, y, x + width, y + height))


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {"schemaVersion": 1, "date": "2026-09-02", "units": {}}
    for unit_key, spec in SPECS.items():
        config_path = REPO / spec["config"]
        config = json.loads(config_path.read_text(encoding="utf-8"))
        unit_report = {
            "config": spec["config"],
            "nativeFacing": "screen-right",
            "actions": {},
        }
        action_contacts = []
        for action, indices in spec["actions"].items():
            anim = config["animations"][action]
            sheet_path = REPO / anim["src"]
            sheet = Image.open(sheet_path).convert("RGBA")
            cells = [frame(sheet, i, anim["frameWidth"], anim["frameHeight"], anim["cols"]) for i in indices]
            thumb_h = 320
            thumbs = []
            for cell in cells:
                scale = thumb_h / cell.height
                thumbs.append(cell.resize((round(cell.width * scale), thumb_h), Image.Resampling.LANCZOS))
            label_h = 34
            canvas = Image.new("RGB", (sum(im.width for im in thumbs), thumb_h + label_h), "#20252b")
            draw = ImageDraw.Draw(canvas)
            x = 0
            for index, thumb in zip(indices, thumbs):
                background = Image.new("RGB", thumb.size, "white")
                background.paste(thumb, mask=thumb.getchannel("A"))
                canvas.paste(background, (x, 0))
                draw.text((x + 8, thumb_h + 8), f"f{index}", fill="white")
                x += thumb.width
            out = OUTPUT / f"{unit_key}-{action}-contact.png"
            canvas.save(out, optimize=True)
            action_contacts.append((action, canvas))
            unit_report["actions"][action] = {
                "source": anim["src"],
                "frameWidth": anim["frameWidth"],
                "frameHeight": anim["frameHeight"],
                "cols": anim["cols"],
                "frameCount": anim["frameCount"],
                "reviewedFrames": indices,
                "contact": str(out.relative_to(ROOT)).replace("\\", "/"),
            }
        overview_width = max(contact.width for _, contact in action_contacts)
        overview_height = sum(contact.height + 34 for _, contact in action_contacts)
        overview = Image.new("RGB", (overview_width, overview_height), "#11151a")
        draw = ImageDraw.Draw(overview)
        y = 0
        for action, contact in action_contacts:
            draw.text((10, y + 8), action, fill="#ffd36b")
            y += 34
            overview.paste(contact, (0, y))
            y += contact.height
        overview_path = OUTPUT / f"{unit_key}-all-actions-contact.png"
        overview.save(overview_path, optimize=True)
        unit_report["overview"] = str(overview_path.relative_to(ROOT)).replace("\\", "/")
        report["units"][unit_key] = unit_report
    (OUTPUT / "direction-reference-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
