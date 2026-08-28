"""Build compressed runtime mirrors for the complete weapon49-55 pistol set."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[4]
SLUGS = (
    "m1911a1",
    "usp45",
    "five-seven",
    "eternal-edict",
    "falcon-edict",
    "crimson-crown-settlement",
    "myriad-corridor",
)


def save_resized(source: Path, target: Path, size: int) -> None:
    with Image.open(source) as image:
        rgba = image.convert("RGBA")
        resized = rgba.resize((size, size), Image.Resampling.LANCZOS)
        target.parent.mkdir(parents=True, exist_ok=True)
        resized.save(target, format="PNG", optimize=True, compress_level=9)


def main() -> None:
    for slug in SLUGS:
        save_resized(
            ROOT / "assets" / "weapons" / f"{slug}-equip.png",
            ROOT / "assets" / "weapons" / "runtime" / "weapons" / f"{slug}-equip.png",
            512,
        )
        save_resized(
            ROOT / "assets" / "icons" / "firearms" / f"{slug}.png",
            ROOT / "assets" / "ui" / "runtime-icons" / "icons" / "firearms" / f"{slug}.png",
            128,
        )
    print(f"built {len(SLUGS)} pistol runtime texture pairs")


if __name__ == "__main__":
    main()
