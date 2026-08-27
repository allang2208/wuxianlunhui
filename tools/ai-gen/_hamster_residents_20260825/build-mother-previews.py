from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
MOTHERS = ROOT / "mothers"
REFERENCES = ROOT / "references"
PREVIEWS = ROOT / "previews"


def alpha_bbox(image: Image.Image):
    return image.getchannel("A").getbbox()


def main():
    REFERENCES.mkdir(parents=True, exist_ok=True)
    PREVIEWS.mkdir(parents=True, exist_ok=True)

    cards = []
    for index in range(1, 6):
        source = MOTHERS / f"resident-{index:02d}-transparent.png"
        image = Image.open(source).convert("RGBA")
        bbox = alpha_bbox(image)
        if not bbox:
            raise RuntimeError(f"empty alpha: {source}")
        body = image.crop(bbox)
        scale = min(760 / body.width, 760 / body.height)
        size = (max(1, round(body.width * scale)), max(1, round(body.height * scale)))
        body = body.resize(size, Image.Resampling.LANCZOS)

        reference = Image.new("RGBA", (1024, 1024), (255, 255, 255, 255))
        x = (1024 - body.width) // 2
        y = 890 - body.height
        reference.alpha_composite(body, (x, y))
        reference_path = REFERENCES / f"resident-{index:02d}-doubao-white.png"
        reference.convert("RGB").save(reference_path, quality=95)

        card = Image.new("RGB", (320, 380), "#1d2228")
        thumb = reference.convert("RGB").resize((320, 320), Image.Resampling.LANCZOS)
        card.paste(thumb, (0, 0))
        draw = ImageDraw.Draw(card)
        draw.text((12, 338), f"Resident {index:02d}", fill="white")
        cards.append(card)

    contact = Image.new("RGB", (320 * 5, 380), "#1d2228")
    for index, card in enumerate(cards):
        contact.paste(card, (index * 320, 0))
    contact.save(PREVIEWS / "hamster-residents-mother-contact.jpg", quality=94)


if __name__ == "__main__":
    main()
