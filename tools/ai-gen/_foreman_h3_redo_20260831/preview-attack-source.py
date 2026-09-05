"""Decode the newly generated attack for source-motion review; no runtime edits."""
from pathlib import Path
import json
import sys
import av
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
action = sys.argv[1] if len(sys.argv) > 1 else "attack-v04"
video = ROOT / "videos" / f"{action}.mp4"
with av.open(str(video)) as container:
    stream = container.streams.video[0]
    fps = float(stream.average_rate)
    frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
previews = ROOT / "previews"
images = [frame.resize((768, 432), Image.Resampling.LANCZOS) for frame in frames]
durations = [round((i+1)*100/fps)*10-round(i*100/fps)*10 for i in range(len(frames))]
images[0].save(previews / f"{action}-source-speed.gif", save_all=True,
               append_images=images[1:], duration=durations, loop=0, disposal=2)
indices = [round(i*(len(frames)-1)/31) for i in range(32)]
grid = Image.new("RGB", (1536, 1920), "#1d252d")
draw = ImageDraw.Draw(grid)
for slot, index in enumerate(indices):
    x, y = slot%4*384, slot//4*240
    grid.paste(frames[index].resize((384, 216), Image.Resampling.LANCZOS), (x, y+24))
    draw.text((x+8,y+6), f"{action} f{index:03d} / {index/fps:.2f}s", fill="white")
grid.save(previews / f"{action}-32-frames.png")
sheet_manifest_path = ROOT / f"{action}-sheet-manifest.json"
sheet_manifest = json.loads(sheet_manifest_path.read_text()) if sheet_manifest_path.exists() else {}
(ROOT / f"{action}-source-preview.json").write_text(json.dumps({
    "source": f"videos/{action}.mp4", "fps": fps, "frameCount": len(frames),
    "sourceDurationMs": sum(durations), "runtimeInstalled": False,
    "derivedRuntimeIntegrated": sheet_manifest.get("runtimeIntegrationActive", False),
    "prompt": f"prompts/{action}.txt", "review": "Source motion, not game footage."
}, indent=2)+"\n")
print(f"Rendered {action} source preview: {len(frames)} frames at {fps}fps")
