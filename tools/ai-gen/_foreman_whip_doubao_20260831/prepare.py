"""Archive the current whip and derive a wide, unwarped Doubao reference."""
from pathlib import Path
import json
import shutil
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
for folder in ("references", "before", "prompts", "videos", "previews", "sheets"):
    (HERE / folder).mkdir(exist_ok=True)

source = ROOT / "assets/enemies/foreman_zombie"
idle = Image.open(source / "idle.png").convert("RGBA").crop((0, 0, 512, 512))
idle.save(HERE / "references/foreman-idle-master.png")
shutil.copy2(source / "attacking.png", HERE / "before/attacking.png")
bbox = idle.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
body = idle.crop(bbox)
scale = 340 / body.height
body = body.resize((round(body.width * scale), 340), Image.Resampling.LANCZOS)
reference = Image.new("RGBA", (1280, 720), "white")
reference.alpha_composite(body, (470 - body.width // 2, 550 - body.height))
reference.convert("RGB").save(HERE / "references/foreman-whip-wide-v01.png")

attack = Image.open(source / "attacking.png").convert("RGBA")
frames, rows = [], []
for i in range(31):
    x, y = i % 8 * 512, i // 8 * 512
    frame = attack.crop((x, y, x + 512, y + 512))
    b = frame.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
    rows.append({"frame": i, "bbox": b, "touchesFrame": bool(b and (b[0] == 0 or b[1] == 0 or b[2] == 512 or b[3] == 512))})
    canvas = Image.new("RGBA", (512, 512), (40, 45, 51, 255))
    canvas.alpha_composite(frame)
    draw_frame = ImageDraw.Draw(canvas)
    draw_frame.rectangle((0, 0, 511, 511), outline=(100, 115, 135), width=2)
    draw_frame.text((8, 8), f"frame {i:02d} | {i / 31 * 1500:.0f}ms", fill="white")
    frames.append(canvas.convert("RGB"))
# A separate 5-column contact sheet with no overlapping cells.
contact = Image.new("RGB", (1280, 7 * 280), (40, 45, 51))
for i, frame in enumerate(frames):
    contact.paste(frame.resize((256, 256), Image.Resampling.LANCZOS), (i % 5 * 256, i // 5 * 280 + 20))
contact.save(HERE / "before/attack-contact.png")
durations = [round((i + 1) * 150 / 31) * 10 - round(i * 150 / 31) * 10 for i in range(31)]
frames[0].save(HERE / "before/attack-current-1500ms.gif", save_all=True, append_images=frames[1:], duration=durations, loop=0, disposal=2)

family = []
for file in source.glob("*.png"):
    with Image.open(file) as image:
        family.append({"path": str(file.relative_to(ROOT)), "size": image.size, "rgbaMiB": image.width * image.height * 4 / 1048576})
record = {
    "status": "candidate-only; no runtime replacement",
    "sourceIdle": str((source / "idle.png").relative_to(ROOT)),
    "sourceAttack": str((source / "attacking.png").relative_to(ROOT)),
    "masterFrame": [0, 0, 512, 512], "idleAlphaBBox": bbox,
    "reference": {"canvas": [1280, 720], "bodyHeight": 340, "bodyCenterX": 470, "footY": 550, "uniformScale": scale},
    "currentAttack": {"frames": 31, "durationMs": 1500, "hitFrame": 18, "hitMs": 18 / 31 * 1500, "soundFrame": 15, "soundMs": 15 / 31 * 1500, "frameBounds": rows},
    "existingFamily": family,
    "scope": "Only recreate whip attack. Preserve identity, natural motion, 1500ms gameplay clock, damage, range, collision, other actions and existing arc VFX. Do not install unapproved candidate.",
}
(HERE / "preparation.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"idleBBox": bbox, "edgeFrames": [r["frame"] for r in rows if r["touchesFrame"]], "existingFamilyMiB": sum(r["rgbaMiB"] for r in family), "reference": record["reference"]}))
