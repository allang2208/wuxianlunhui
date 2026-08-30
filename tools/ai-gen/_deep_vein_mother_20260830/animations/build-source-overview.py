"""Create a source-speed montage from downloaded candidates; no motion edits."""
import json
import math
from pathlib import Path
import av
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
data = json.loads((ROOT / "task-index.json").read_text(encoding="utf-8"))
tile = 280
label_height = 56
fps_out = 12
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 19)
small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 15)
sequences = []
for job in data["jobs"]:
    video = ROOT / job["video"]
    if not video.exists():
        continue
    with av.open(str(video)) as source:
        stream = source.streams.video[0]
        fps = float(stream.average_rate)
        frames = []
        for frame in source.decode(stream):
            rgb = frame.to_image().convert("RGB")
            rgb.thumbnail((tile, tile), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (tile, tile), "white")
            canvas.paste(rgb, ((tile-rgb.width)//2, (tile-rgb.height)//2))
            frames.append(canvas)
    sequences.append((job["label"], frames, fps, job.get("reviewBadge", "源片待选")))
if not sequences:
    raise SystemExit("No downloaded source videos")
duration = max(len(frames)/fps for _,frames,fps,_ in sequences)
count = math.ceil(duration*fps_out)
rows = math.ceil(len(sequences)/3)
boards = []
for n in range(count):
    board = Image.new("RGB", (tile*3, (tile+label_height)*rows), "#20242a")
    draw = ImageDraw.Draw(board)
    for pos,(label,frames,fps,badge) in enumerate(sequences):
        x,y = (pos%3)*tile,(pos//3)*(tile+label_height)
        t = n/fps_out
        frame_index = min(len(frames)-1, int(t*fps))
        board.paste(frames[frame_index], (x,y+label_height))
        draw.text((x+8,y+5), label, font=font, fill="white")
        draw.text((x+8,y+31), badge, font=small, fill="#ffc477")
        if t >= len(frames)/fps:
            draw.text((x+170,y+8), "源片已结束", font=small, fill="#c5cbd2")
    boards.append(board)
bounds = [round(n/fps_out*100) for n in range(count)] + [round(duration*100)]
durations = [max(1,bounds[n+1]-bounds[n])*10 for n in range(count)]
out = ROOT / "previews"
out.mkdir(exist_ok=True)
destination = out / f"{len(sequences)}-actions-source-overview.gif"
boards[0].save(destination, save_all=True, append_images=boards[1:], duration=durations, loop=0, disposal=2, optimize=False)
(out/"overview-report.json").write_text(json.dumps({
    "states":[label for label,_,_,_ in sequences], "durationMs":sum(durations),
    "sources":[{"state":job["state"], "video":job["video"], "reviewBadge":job.get("reviewBadge", "源片待选")} for job in data["jobs"] if (ROOT/job["video"]).exists()],
    "note":"Source-speed review montage at approximately 12 fps. Shorter clips hold their last frame and are labeled as ended. GIF replay is for review only, not runtime action looping."
},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(destination)
