from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent / "previews"
OUT.mkdir(parents=True, exist_ok=True)

SHEETS = {
    "idle": (ROOT / "assets/enemies/spitter_zombie/v2/idle.png", 512, 512, 24, 90),
    "walking": (ROOT / "assets/enemies/spitter_zombie/v2/walking.png", 512, 512, 24, 70),
    "attacking": (ROOT / "assets/enemies/spitter_zombie/v2/attacking.png", 1152, 640, 24, 70),
    "dying": (ROOT / "assets/enemies/spitter_zombie/v2/dying.png", 640, 640, 24, 90),
}


def main() -> None:
    failures: list[str] = []
    for name, (path, frame_width, frame_height, frame_count, duration) in SHEETS.items():
        sheet = Image.open(path).convert("RGBA")
        expected = (frame_width * 6, frame_height * 4)
        if sheet.size != expected:
            failures.append(f"{name}: size={sheet.size}, expected={expected}")

        frames: list[Image.Image] = []
        alpha_counts: list[int] = []
        edge_hits: list[int] = []
        bad_transparent_rgb = 0
        for index in range(frame_count):
            x = (index % 6) * frame_width
            y = (index // 6) * frame_height
            frame = sheet.crop((x, y, x + frame_width, y + frame_height))
            alpha = frame.getchannel("A")
            alpha_counts.append(sum(1 for value in alpha.getdata() if value))
            edge = Image.new("L", (frame_width, frame_height))
            edge.paste(alpha.crop((0, 0, frame_width, 1)), (0, 0))
            edge.paste(alpha.crop((0, frame_height - 1, frame_width, frame_height)), (0, frame_height - 1))
            edge.paste(alpha.crop((0, 0, 1, frame_height)), (0, 0))
            edge.paste(alpha.crop((frame_width - 1, 0, frame_width, frame_height)), (frame_width - 1, 0))
            if edge.getbbox() is not None:
                edge_hits.append(index)

            for r, g, b, a in frame.getdata():
                if a == 0 and (r or g or b):
                    bad_transparent_rgb += 1

            preview = Image.new("RGB", (frame_width, frame_height), (24, 22, 22))
            preview.paste(frame, mask=alpha)
            preview.thumbnail((384, 384), Image.Resampling.LANCZOS)
            frames.append(preview)

        if min(alpha_counts, default=0) <= 50:
            failures.append(f"{name}: blank/near-blank registered frame")
        if edge_hits:
            failures.append(f"{name}: alpha touches cell edge at {edge_hits}")
        if bad_transparent_rgb:
            failures.append(f"{name}: {bad_transparent_rgb} transparent pixels have RGB data")

        gif_path = OUT / f"{name}.gif"
        frames[0].save(
            gif_path,
            save_all=True,
            append_images=frames[1:],
            duration=duration,
            loop=0 if name in {"idle", "walking"} else 1,
            optimize=False,
        )
        print(
            f"{name}: sheet={sheet.size[0]}x{sheet.size[1]} cell={frame_width}x{frame_height} "
            f"frames={frame_count} alpha={min(alpha_counts)}..{max(alpha_counts)} "
            f"edge_hits={edge_hits} transparent_rgb={bad_transparent_rgb} gif={gif_path}"
        )

    if failures:
        raise SystemExit("\n".join(failures))


if __name__ == "__main__":
    main()
