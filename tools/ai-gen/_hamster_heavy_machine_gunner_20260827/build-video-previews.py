from __future__ import annotations

import hashlib
import json
from pathlib import Path

import av
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
PREVIEW_DIR = ROOT / "previews" / "videos"
TARGET_FPS = 10.0
GIF_SIZE = (512, 288)
CONTACT_COLUMNS = 4
CONTACT_ROWS = 3
CONTACT_CELL = (384, 216)
STATES = ("idle", "running", "attacking", "dying")


def fit_on_white(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    fitted = image.copy()
    fitted.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, "white")
    canvas.paste(fitted, ((size[0] - fitted.width) // 2, (size[1] - fitted.height) // 2))
    return canvas


def decode_video(source: Path) -> tuple[list[Image.Image], dict[str, object]]:
    container = av.open(str(source))
    stream = container.streams.video[0]
    source_fps = float(stream.average_rate or 24)
    width = int(stream.codec_context.width)
    height = int(stream.codec_context.height)
    frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    container.close()
    if not frames:
        raise RuntimeError(f"no frames decoded from {source}")
    return frames, {
        "width": width,
        "height": height,
        "sourceFps": source_fps,
        "frameCount": len(frames),
        "durationSeconds": len(frames) / source_fps,
    }


def evenly_spaced_indices(frame_count: int, sample_count: int) -> list[int]:
    if sample_count <= 1:
        return [0]
    return [round(index * (frame_count - 1) / (sample_count - 1)) for index in range(sample_count)]


def build_preview(state: str) -> dict[str, object]:
    source = VIDEO_DIR / f"{state}-doubao-v01.mp4"
    frames, report = decode_video(source)
    source_fps = float(report["sourceFps"])

    stride = max(1, round(source_fps / TARGET_FPS))
    gif_frames = [fit_on_white(frame, GIF_SIZE) for frame in frames[::stride]]
    playback_fps = source_fps / stride
    duration_ms = round(1000 / playback_fps)
    gif_path = PREVIEW_DIR / f"{state}-preview.gif"
    gif_frames[0].save(
        gif_path,
        save_all=True,
        append_images=gif_frames[1:],
        duration=duration_ms,
        loop=0,
        disposal=2,
    )

    sample_indices = evenly_spaced_indices(len(frames), CONTACT_COLUMNS * CONTACT_ROWS)
    label_height = 24
    sheet = Image.new(
        "RGB",
        (CONTACT_COLUMNS * CONTACT_CELL[0], CONTACT_ROWS * (CONTACT_CELL[1] + label_height)),
        "#dddddd",
    )
    draw = ImageDraw.Draw(sheet)
    for slot, frame_index in enumerate(sample_indices):
        col = slot % CONTACT_COLUMNS
        row = slot // CONTACT_COLUMNS
        x = col * CONTACT_CELL[0]
        y = row * (CONTACT_CELL[1] + label_height)
        sheet.paste(fit_on_white(frames[frame_index], CONTACT_CELL), (x, y))
        draw.text((x + 8, y + CONTACT_CELL[1] + 5), f"frame {frame_index}", fill="black")
    contact_path = PREVIEW_DIR / f"{state}-contact.png"
    sheet.save(contact_path, optimize=True)

    report.update({
        "state": state,
        "source": source.relative_to(ROOT).as_posix(),
        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "previewGif": gif_path.relative_to(ROOT).as_posix(),
        "previewFrames": len(gif_frames),
        "previewFps": playback_fps,
        "contactSheet": contact_path.relative_to(ROOT).as_posix(),
        "contactFrameIndices": sample_indices,
    })
    print(
        f"{state}: {report['width']}x{report['height']} {source_fps:.3f}fps "
        f"frames={len(frames)} duration={report['durationSeconds']:.3f}s "
        f"sha256={report['sha256']}"
    )
    return report


def main() -> None:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    report = {state: build_preview(state) for state in STATES}
    report_path = PREVIEW_DIR / "video-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"report -> {report_path}")


if __name__ == "__main__":
    main()
