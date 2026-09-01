from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[5]
SOURCE = ROOT / "assets/companions/trench_assault/idle.png"
OUTPUT = ROOT / "assets/ui/unit-icons/hamster-trench-assault.png"

FRAME_WIDTH = 336
FRAME_HEIGHT = 160
# The runtime sheets are the original 512px action frames cropped at
# (88, 208)-(424, 368). Restoring that offset preserves the established
# friendly-unit icon scale without resampling the approved pixels.
RESTORE_OFFSET = (88, 208)


def main() -> None:
    sheet = Image.open(SOURCE).convert("RGBA")
    first_frame = sheet.crop((0, 0, FRAME_WIDTH, FRAME_HEIGHT))
    icon = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    icon.alpha_composite(first_frame, RESTORE_OFFSET)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    icon.save(OUTPUT, optimize=True)
    print(f"wrote {OUTPUT} bbox={icon.getbbox()}")


if __name__ == "__main__":
    main()
