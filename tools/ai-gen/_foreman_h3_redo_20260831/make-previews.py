"""Create source-speed previews of existing H3 candidates; never install assets."""
from pathlib import Path
import json
import av
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "previews"
OUT.mkdir(exist_ok=True)
records = []
for action in ("walk-v01", "attack-v01", "attack-v02"):
    video = ROOT / "videos" / f"{action}.mp4"
    if not video.exists():
        continue
    with av.open(str(video)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    if not frames:
        continue
    # Preview the whole canvas: no body stabilization or hidden whip cropping.
    thumbs = [frame.resize((768, 432), Image.Resampling.LANCZOS) for frame in frames]
    durations = [round((i + 1) * 100 / fps) * 10 - round(i * 100 / fps) * 10
                 for i in range(len(frames))]
    gif = OUT / f"{action}-source-speed.gif"
    thumbs[0].save(gif, save_all=True, append_images=thumbs[1:], duration=durations,
                   loop=0, disposal=2)
    contact = Image.new("RGB", (4 * 384, 8 * 240), (25, 29, 34))
    draw = ImageDraw.Draw(contact)
    indices = [round(i * (len(frames) - 1) / 31) for i in range(32)]
    for slot, index in enumerate(indices):
        x, y = slot % 4 * 384, slot // 4 * 240
        contact.paste(frames[index].resize((384, 216), Image.Resampling.LANCZOS), (x, y + 24))
        draw.text((x + 8, y + 6), f"{action} f{index:03d} / {index / fps:.2f}s", fill="white")
    contact.save(OUT / f"{action}-32-frames.png")
    records.append({"action": action, "source": str(video.relative_to(ROOT)),
                    "fps": fps, "frameCount": len(frames), "durationMs": sum(durations),
                    "gif": str(gif.relative_to(ROOT)), "runtimeInstalled": False})
(OUT / "manifest.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(records))
