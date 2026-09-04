"""Register an image_gen fist to the existing off-arm wrist; source art stays intact."""
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parents[1] / 'parts/offForearm.png'

# Use only the generated fist. The extra long bones in the raw output are rejected.
# The old 34x105 part's wrist is (23,71); preserve its elbow, forearm and wrist pixels.
RAW_CROP = (312, 772, 746, 1266)
FIST_SIZE = (18, 21)
FIST_POSITION = (14, 74)
KEEP_SOURCE_ROWS = 76


def main():
    original = Image.open(SOURCE).convert('RGBA')
    raw = Image.open(HERE / 'generated-fist.png').convert('RGBA')
    fist = raw.crop(RAW_CROP).resize(FIST_SIZE, Image.Resampling.LANCZOS)
    part = Image.new('RGBA', original.size)
    part.alpha_composite(fist, FIST_POSITION)
    part.alpha_composite(original.crop((0, 0, original.width, KEEP_SOURCE_ROWS)), (0, 0))
    part.save(HERE / 'offForearm-fist.png')

    # Offline authoring presentation only; no browser/game or runtime checks.
    board = Image.new('RGB', (416, 480), '#454a50')
    draw = ImageDraw.Draw(board)
    for column, (label, image) in enumerate((('OPEN / SOURCE', original), ('CLOSED / SOLO RUN', part))):
        draw.text((column * 208 + 20, 16), label, fill='#f1ead7')
        enlarged = image.resize((image.width * 4, image.height * 4), Image.Resampling.NEAREST)
        board.paste(enlarged, (column * 208 + 32, 42), enlarged)
    board.save(HERE / 'part-detail.png')
    print('Prepared solo-only fist part: 34x105, original wrist and forearm retained.')


if __name__ == '__main__':
    main()
