"""Produce offline sprite contact sheets and layout/provenance records (no game execution)."""
from pathlib import Path
import json
import math

import numpy as np
from PIL import Image, ImageDraw
from rebuild import extract, module

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    rife = module("red_wolf_delivery_rife", ROOT.parent / "rife-spritesheet-interpolate.py")
    names = ["idle", "run", "attack", "pounce", "howl", "dying",
             "werewolfIdle", "werewolfRun", "werewolfAttack", "werewolfPounce", "werewolfHowl", "werewolfDying"]
    contact = Image.new("RGB", (6 * 350, 2 * 460), "#30343a")
    draw = ImageDraw.Draw(contact)
    records = {}
    for name, action in manifest["actions"].items():
        lay = action["layout"]
        w, h = lay["frameWidth"], lay["frameHeight"]
        frames = extract(ROOT / action["sheet"], lay["cols"], lay["frames"], w, h)
        boxes = [Image.fromarray(frame).getbbox() for frame in frames]
        native = action.get("nativeMiddleFrames", {}) or action.get("retainedNativeReplacementFrames", {})
        dark = {}
        for i in range(1, len(frames), 2):
            if str(i) in native: continue
            pixels = int(rife.temporal_dark_outlier_mask(frames[i], frames[i-1], frames[(i+1) % len(frames)]).sum())
            if pixels: dark[i] = pixels
        records[name] = {
            "layout": lay, "sourceVideo": action["sourceVideo"],
            "sourceVideoExists": (REPO / action["sourceVideo"]).is_file(),
            "emptyFrames": [i for i, box in enumerate(boxes) if box is None],
            "framesTouchingCellEdge": [i for i, box in enumerate(boxes) if box and (box[0] == 0 or box[1] == 0 or box[2] == w or box[3] == h)],
            "nonzeroRgbInTransparentPixels": sum(int(np.any(frame[..., :3][frame[..., 3] == 0] != 0, axis=-1).sum()) for frame in frames),
            "firstPoseAlphaHeight": boxes[0][3] - boxes[0][1],
            "visibleDarkOutlierPixelsInGeneratedMiddles": dark,
            "keysPreservedAfterCrop": action["keysPreservedAfterCrop"],
            "sheetPixels": [lay["cols"] * w, lay["rows"] * h],
        }
        if name not in names: continue
        n = names.index(name)
        x, y = n % 6 * 350, n // 6 * 460
        scale = 151 / 512 * (1.8 if name.startswith("werewolf") else 1) * 2
        frame = Image.fromarray(frames[0])
        frame = frame.resize((round(w * scale), round(h * scale)), Image.Resampling.LANCZOS)
        contact.paste(frame, (round(x + 175 - lay["footX"] * scale), round(y + 400 - lay["footY"] * scale)), frame)
        draw.line((x+10, y+400, x+340, y+400), fill="#64717d")
        draw.text((x+15,y+423), f"{name} / {lay['frames']} frames", fill="white")
        draw.text((x+15,y+443), f"fixed pixel scale {scale/2:.6f}", fill="#b4c2cd")
    contact.save(ROOT / "previews/form-scale-overview.png")
    report = {"kind": "offline sprite production", "runtimeTestsRun": False,
              "rgbaMiBBefore": 544.703125, "rgbaMiBAfter": manifest["rgbaMiB"], "actions": records}
    (ROOT / "delivery-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    for name, item in records.items():
        print(name, "empty", item["emptyFrames"], "edge", item["framesTouchingCellEdge"],
              "hiddenRgb", item["nonzeroRgbInTransparentPixels"], "darkMiddles", item["visibleDarkOutlierPixelsInGeneratedMiddles"])


if __name__ == "__main__":
    main()
