from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent / "references"

SOURCES = [
    {
        "worker": "oil technician",
        "role": "primary civilian industrial gait",
        "path": ROOT / "assets/companions/hamster_boiler_worker/empty_running.png",
        "frame": (256, 256),
        "indices": [0, 4, 8],
    },
    {
        "worker": "cannery worker",
        "role": "primary food-worker gait",
        "path": ROOT / "assets/companions/hamster_baker/empty_running.png",
        "frame": (512, 512),
        "indices": [0, 7, 14],
    },
    {
        "worker": "trade clerk",
        "role": "primary commercial-worker gait",
        "path": ROOT / "assets/companions/hamster_banker/running.png",
        "frame": (512, 512),
        "indices": [0, 6, 12],
    },
]


def extract_frame(sheet: Image.Image, frame_size: tuple[int, int], index: int) -> Image.Image:
    fw, fh = frame_size
    cols = sheet.width // fw
    x = (index % cols) * fw
    y = (index // cols) * fh
    return sheet.crop((x, y, x + fw, y + fh))


def composite_on_white(frame: Image.Image, size: int = 400) -> Image.Image:
    frame = frame.convert("RGBA")
    frame.thumbnail((size - 24, size - 24), Image.Resampling.LANCZOS)
    cell = Image.new("RGBA", (size, size), "white")
    x = (size - frame.width) // 2
    y = size - frame.height - 12
    cell.alpha_composite(frame, (x, y))
    return cell.convert("RGB")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default()
    title_h = 64
    label_h = 44
    cell = 400
    board = Image.new("RGB", (cell * 3, title_h + (cell + label_h) * len(SOURCES)), "#e9edf2")
    draw = ImageDraw.Draw(board)
    draw.text((16, 16), "Existing hamster movement reference: three real gait phases per worker", fill="#16202b", font=font)

    for row, source in enumerate(SOURCES):
        with Image.open(source["path"]) as sheet:
            sheet = sheet.convert("RGBA")
            for col, index in enumerate(source["indices"]):
                frame = extract_frame(sheet, source["frame"], index)
                name = f"{source['worker'].replace(' ', '-')}-direction-f{index:02d}.png"
                frame.save(OUT / name)
                preview = composite_on_white(frame, cell)
                x = col * cell
                y = title_h + row * (cell + label_h)
                board.paste(preview, (x, y))
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), outline="#93a0ad", width=2)
                draw.text(
                    (x + 10, y + cell + 8),
                    f"{source['worker']} | frame {index} | {source['role']}",
                    fill="#16202b",
                    font=font,
                )

    board.save(OUT / "existing-hamster-direction-contact.png")


if __name__ == "__main__":
    main()
