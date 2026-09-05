"""Read-only asset inspection: extract original pixels; never modify runtime art."""
import json
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
SOURCE = ROOT / "tools/ai-gen/_rotbog_rhinoceros_beetle_king_20260828"
CONFIG = json.loads((ROOT / "data/enemy-config.json").read_text(encoding="utf-8"))["rotbogRhinocerosBeetleKing"]


def composite(frame, bg):
    base = Image.new("RGBA", frame.size, bg)
    base.alpha_composite(frame)
    return base.convert("RGB")


def extract(sheet, index, width, height, cols):
    row, col = divmod(index, cols)
    return sheet.crop((col * width, row * height, (col + 1) * width, (row + 1) * height))


def main():
    report = {"scope": "asset pixels only; no game/runtime test; no repaired pixels", "actions": {}}
    selected = []
    charge_frames = []
    for state, layout in CONFIG["textures"]["frameLayouts"].items():
        path = ROOT / CONFIG["textures"][state]
        sheet = Image.open(path).convert("RGBA")
        width, height = layout["frameWidth"], layout["frameHeight"]
        cols = sheet.width // width
        records = []
        for index in range(layout["frameCount"]):
            frame = extract(sheet, index, width, height, cols)
            pixels = np.array(frame)
            rgb, alpha = pixels[..., :3].astype(np.int16), pixels[..., 3]
            blue = (rgb[..., 2] - np.maximum(rgb[..., 0], rgb[..., 1]) > 18) & (alpha >= 12)
            cyan = (np.minimum(rgb[..., 1], rgb[..., 2]) - rgb[..., 0] > 18) & (alpha >= 12)
            records.append({"index": index, "bbox": frame.getchannel("A").getbbox(),
                            "semiTransparentPixels": int(((alpha >= 12) & (alpha < 240)).sum()),
                            "blueExcessPixels": int(blue.sum()), "cyanExcessPixels": int(cyan.sum())})
            if state == "charge":
                charge_frames.append(frame)
            if (state in ("idle", "walk") and index in (0, 1)) or (state == "charge" and index in (0, 12, 13, 16, 17, 22, 30)):
                frame.save(OUT / f"{state}-frame-{index:02d}-original.png")
                # A shared crop for inspection only, with no individual re-alignment.
                crop = frame.crop((width // 2 - 210, 320, width // 2 + 220, 555))
                selected.append((f"{state} frame {index:02d} / " + ("source key" if index % 2 == 0 else "RIFE middle"), crop))
        report["actions"][state] = {"path": str(path.relative_to(ROOT)), "sheetSize": list(sheet.size), "actualColumns": cols,
                                    "configuredColumns": layout["columns"], "frames": records}

    # Render original pixels on two solid backgrounds; do not sharpen or repair.
    board = Image.new("RGB", (860, len(selected) * 260), "#202329")
    draw = ImageDraw.Draw(board)
    for row, (label, crop) in enumerate(selected):
        y = row * 260
        draw.text((8, y + 5), label + " | DARK / LIGHT | 1:1 pixels", fill="white")
        board.paste(composite(crop, "#202329"), (0, y + 25))
        board.paste(composite(crop, "#dddddd"), (430, y + 25))
    board.save(OUT / "original-frames-dark-light.png")

    detail = charge_frames[16].crop((200, 290, 610, 530))
    composite(detail, "#555b63").resize((820, 480), Image.Resampling.NEAREST).save(OUT / "charge-frame-16-edge-detail.png")
    key_sheet = Image.open(SOURCE / "spritesheets/runtime/charge-key.png").convert("RGBA")
    key_frame = extract(key_sheet, 8, 768, 640, 5)
    key_frame.save(OUT / "charge-key-08-before-rife-original.png")
    key_pixels, runtime_pixels = np.asarray(key_frame), np.asarray(charge_frames[16])
    report["chargeKey08VsRuntime16"] = {"identicalPixels": bool(np.array_equal(key_pixels, runtime_pixels)),
                                       "changedPixels": int(np.any(key_pixels != runtime_pixels, axis=2).sum())}

    durations = [round((i + 1) * 240 / 31) * 10 - round(i * 240 / 31) * 10 for i in range(31)]
    previews = [composite(frame.crop((150, 300, 620, 565)), "#4b5057") for frame in charge_frames]
    previews[0].save(OUT / "charge-current-original-pixels.gif", save_all=True,
                     append_images=previews[1:], duration=durations, loop=0, disposal=2)

    video_path = SOURCE / "videos/charge-doubao-v03.mp4"
    with av.open(str(video_path)) as container:
        stream = container.streams.video[0]
        report["sourceVideo"] = {"path": str(video_path.relative_to(ROOT)), "width": stream.width, "height": stream.height}
        for index, frame in enumerate(container.decode(stream)):
            if index in (0, 56, 64, 68, 80):
                frame.to_image().save(OUT / f"charge-source-video-frame-{index:03d}.png")
            if index >= 80:
                break

    (OUT / "inspection.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({state: {"size": data["sheetSize"], "columns": data["actualColumns"],
                                "empty": [f["index"] for f in data["frames"] if f["bbox"] is None],
                                "blueMax": max(f["blueExcessPixels"] for f in data["frames"]),
                                "cyanMax": max(f["cyanExcessPixels"] for f in data["frames"])}
                      for state, data in report["actions"].items()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
