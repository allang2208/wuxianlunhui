#!/usr/bin/env python3
"""Create one compact four-state GIF and a static review board for Codex display."""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "sprite-sheet-manifest.json"
DYING_V02_MANIFEST = ROOT / "dying-fracture-v02-sprite-manifest.json"
OUT_DIR = ROOT / "previews" / "review"
BOARD_SIZE = (720, 480)
PANEL_SIZE = (360, 240)
FPS = 20
DURATION_SECONDS = 2.5
FRAME_COUNT = round(FPS * DURATION_SECONDS)
LABELS = {
    "idle": "待机  IDLE",
    "walking": "移动  MOVE",
    "attacking": "攻击  ATTACK",
    "dying": "死亡  DEATH",
}
ORDER = ("idle", "walking", "attacking", "dying")


def font(size: int):
    candidates = (
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\arial.ttf"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def checker(size: tuple[int, int]) -> Image.Image:
    image = Image.new("RGB", size, "#34373c")
    draw = ImageDraw.Draw(image)
    block = 16
    for y in range(0, size[1], block):
        for x in range(0, size[0], block):
            color = "#3d4147" if (x // block + y // block) % 2 == 0 else "#30343a"
            draw.rectangle((x, y, x + block - 1, y + block - 1), fill=color)
    return image


def extract_cells(action: dict) -> list[Image.Image]:
    sheet = Image.open(ROOT / action["file"]).convert("RGBA")
    cells = []
    for index in range(action["frameCount"]):
        row, col = divmod(index, action["columns"])
        x = col * action["frameWidth"]
        y = row * action["frameHeight"]
        cells.append(sheet.crop((x, y, x + action["frameWidth"], y + action["frameHeight"])))
    return cells


def fit_subject(cell: Image.Image) -> Image.Image:
    bbox = cell.getchannel("A").getbbox()
    if not bbox:
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    subject = cell.crop(bbox)
    max_w, max_h = 316, 186
    scale = min(max_w / subject.width, max_h / subject.height)
    target = (max(1, round(subject.width * scale)), max(1, round(subject.height * scale)))
    return subject.resize(target, Image.Resampling.LANCZOS)


def panel(label: str, cell: Image.Image) -> Image.Image:
    image = checker(PANEL_SIZE).convert("RGBA")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, PANEL_SIZE[0], 38), fill="#202328")
    draw.text((14, 7), label, font=font(22), fill="#f1f3f5")
    subject = fit_subject(cell)
    x = (PANEL_SIZE[0] - subject.width) // 2
    y = PANEL_SIZE[1] - 14 - subject.height
    image.alpha_composite(subject, (x, y))
    return image.convert("RGB")


def compose(frame_map: dict[str, Image.Image]) -> Image.Image:
    board = Image.new("RGB", BOARD_SIZE, "#17191d")
    for index, name in enumerate(ORDER):
        x = (index % 2) * PANEL_SIZE[0]
        y = (index // 2) * PANEL_SIZE[1]
        board.paste(panel(LABELS[name], frame_map[name]), (x, y))
    return board


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    actions = dict(manifest["actions"])
    if DYING_V02_MANIFEST.exists():
        actions["dying"] = json.loads(DYING_V02_MANIFEST.read_text(encoding="utf-8"))
    cells = {name: extract_cells(actions[name]) for name in ORDER}
    frames = []
    for output_index in range(FRAME_COUNT):
        time = output_index / FPS
        selected = {}
        for name in ORDER:
            action = actions[name]
            source_index = math.floor(time * action["frameRate"])
            if action["repeat"] == -1:
                source_index %= action["frameCount"]
            else:
                source_index = min(source_index, action["frameCount"] - 1)
            selected[name] = cells[name][source_index]
        frames.append(compose(selected))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    gif_path = OUT_DIR / "evil-treant-four-state-preview.gif"
    frames[0].save(
        gif_path,
        save_all=True,
        append_images=frames[1:],
        duration=round(1000 / FPS),
        loop=0,
        disposal=2,
        optimize=False,
    )

    still_indices = {
        "idle": 0,
        "walking": min(12, actions["walking"]["frameCount"] - 1),
        "attacking": actions["attacking"].get("contactFrame", 16),
        "dying": actions["dying"]["frameCount"] - 1,
    }
    still = compose({name: cells[name][still_indices[name]] for name in ORDER})
    still_path = OUT_DIR / "evil-treant-four-state-contact.png"
    still.save(still_path)
    print(json.dumps({
        "gif": str(gif_path),
        "contact": str(still_path),
        "size": list(BOARD_SIZE),
        "frames": FRAME_COUNT,
        "fps": FPS,
        "durationSeconds": DURATION_SECONDS,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
