"""Beetle-only RIFE colour reconstruction candidates; never changes source keys."""
from pathlib import Path
import importlib.util
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


if __name__ == "__main__":
    build = module("beetle_build", ROOT / "rebuild.py")
    rife = module("beetle_rife", ROOT.parent / "rife-spritesheet-interpolate.py")
    meta = build.read(ROOT / "keys/walk.json")
    cells = build.extract(ROOT / "keys/walk.png", meta)
    folder = ROOT / "interpolation-candidates"
    folder.mkdir(exist_ok=True)
    for idx, cell in enumerate(cells[:2]):
        Image.fromarray(rife.bleed_rgb(cell)).save(folder / f"bleed-{idx}.png")
        distance, nearest = ndimage.distance_transform_edt(cell[..., 3] <= 8, return_indices=True)
        for radius in (3, 8):
            filled = cell[..., :3][nearest[0], nearest[1]].copy()
            filled[distance > radius] = [83, 75, 65]
            Image.fromarray(filled).save(folder / f"bounded{radius}-{idx}.png")
        a = cell[..., 3:4].astype(np.float32) / 255
        for name, bg in (("blue", [0, 0, 255]), ("black", [0, 0, 0])):
            rgb = np.rint(cell[..., :3] * a + np.array(bg) * (1 - a)).astype(np.uint8)
            Image.fromarray(rgb).save(folder / f"{name}-{idx}.png")
        Image.fromarray(cell[..., 3]).save(folder / f"alpha-{idx}.png")
    for name in ("bleed", "blue", "black", "alpha", "bounded3", "bounded8"):
        rife.run_rife(rife.DEFAULT_RIFE, folder / f"{name}-0.png", folder / f"{name}-1.png",
                      folder / f"{name}-middle.png")
    alpha = np.asarray(Image.open(folder / "alpha-middle.png").convert("L"))
    bleed = np.asarray(Image.open(folder / "bleed-middle.png").convert("RGB"))
    rgb = np.asarray(Image.open(folder / "blue-middle.png").convert("RGB")).astype(np.float32)
    chroma_alpha = np.clip(255 - np.maximum(0, rgb[..., 2] - rgb[..., :2].max(axis=2)), 0, 255)
    a = chroma_alpha[..., None] / 255
    unmixed = np.clip((rgb - np.array([0, 0, 255]) * (1 - a)) / np.maximum(a, 1e-5), 0, 255)
    chroma = np.dstack((unmixed.astype(np.uint8), chroma_alpha.astype(np.uint8)))
    chroma[chroma[..., 3] < 5] = 0
    black = np.asarray(Image.open(folder / "black-middle.png").convert("RGB")).astype(np.float32)
    unpremult = np.clip(black / np.maximum(alpha[..., None] / 255, 1e-5), 0, 255).astype(np.uint8)
    bounded = [np.dstack((np.asarray(Image.open(folder / f"bounded{r}-middle.png").convert("RGB")), alpha)) for r in (3, 8)]
    outputs = [cells[0], np.dstack((bleed, alpha)), chroma, np.dstack((unpremult, alpha)), *bounded, cells[1]]
    labels = ["source 0", "bleed + alpha", "blue composite", "black + alpha", "bounded 3", "bounded 8", "source 1"]
    w, h = cells[0].shape[1], cells[0].shape[0]
    contact = Image.new("RGB", (w * len(outputs), h + 25), (51, 55, 61))
    draw = ImageDraw.Draw(contact)
    for i, (cell, label) in enumerate(zip(outputs, labels)):
        bg = Image.new("RGBA", (w, h), (51, 55, 61, 255))
        bg.alpha_composite(Image.fromarray(cell))
        contact.paste(bg.convert("RGB"), (i * w, 25))
        draw.text((i * w + 5, 5), label, fill="white")
    contact.save(folder / "walk-pair-colour.png")
