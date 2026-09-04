"""Preserve the approved mother and pad it losslessly for video input."""
from pathlib import Path
from PIL import Image
import json
import shutil

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / "mother" / "zombie-dog-mother-v04-wolf-camera-white.png"
for name in ("references", "prompts", "videos", "previews"):
    (ROOT / name).mkdir(exist_ok=True)
approved = ROOT / "references" / "zombie-dog-mother-v04-approved.png"
shutil.copy2(SOURCE, approved)
with Image.open(approved) as source:
    canvas = Image.new("RGB", (2048, 1152), "white")
    offset = ((canvas.width - source.width) // 2, (canvas.height - source.height) // 2)
    canvas.paste(source, offset)
    canvas.save(ROOT / "references" / "zombie-dog-v04-video-safe-2048x1152.png")
manifest = {
    "created": "2026-08-31",
    "enemy": "zombieDog",
    "motherStatus": "user-approved",
    "approval": "User accepted v04 and explicitly requested Doubao idle, running, attack and death animations.",
    "motherSource": "../mother/zombie-dog-mother-v04-wolf-camera-white.png",
    "attachment": "C:/Users/allan/AppData/Local/Temp/codex-clipboard-333d80d2-027b-4783-8cfa-db1ec287a464.png",
    "reference": "references/zombie-dog-v04-video-safe-2048x1152.png",
    "referencePreparation": {
        "operation": "white canvas padding only, original image pixels pasted unchanged",
        "sourceSize": [1536, 1024], "canvasSize": [2048, 1152], "pasteOffset": list(offset),
        "resized": False, "cutout": False, "redrawn": False
    },
    "provider": "doubao-desktop",
    "requestedModel": "Seedance 2.0 Mini",
    "requestedDurationSeconds": 5,
    "requestedRatio": "16:9",
    "paidQuotaAuthorized": False,
    "runtimeIntegrationActive": False,
    "spriteSheetsProduced": False,
    "actions": {
        action: {
            "prompt": f"prompts/zombie-dog-{action}-doubao-v01.txt",
            "video": f"videos/zombie-dog-{action}-doubao-v01.mp4",
            "motion": motion,
            "status": "prepared-not-submitted"
        }
        for action, motion in (
            ("idle", "loop"),
            ("running", "cyclic gait; source loop selection remains pending"),
            ("attack", "one bite with recovery"),
            ("dying", "one-way collapse and corpse hold")
        )
    }
}
(ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Prepared approved mother and padded reference: {ROOT}")
