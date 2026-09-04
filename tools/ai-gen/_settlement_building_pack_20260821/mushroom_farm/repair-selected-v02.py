"""Prepare bounded structural repairs and preserve selected v02 outside the mask."""
import argparse
import copy
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
OUT = ROOT / "local_structure_repair_20260830"
SOURCE = ROOT / "structure_12step_20260830/mushroom_farm/mushroom_farm_structure_v02_raw.png"
MASK = OUT / "mushroom_farm_repair_mask.png"
REGIONS = {
    "two_shelf_nursery": [(150, 646), (211, 670), (348, 609), (348, 701), (210, 759), (150, 726)],
    "sorting_house_facades": [(376, 498), (456, 540), (619, 467), (619, 549), (478, 628), (376, 580)],
    "small_mushroom_emblem": [512, 420, 574, 498],
}
REQUEST = (
    "Correct only the three masked regions of this existing mushroom farm, using the supplied Blender Depth. "
    "Under the left cloth canopy, replace the THREE-level rack with exactly TWO horizontal wooden shelves, "
    "one upper and one lower, with a large clearly open gap between; place modest cream mushrooms on those two shelves only. "
    "On the house, remove the extra door from the short screen-left end wall and continue beige plaster and dark timber there. "
    "On the long screen-right front wall, place exactly ONE centered rectangular double door between TWO small square windows, "
    "one on each side of the door, matching the authored Depth. "
    "On the roof, remove the large circular medallion and its entire frame; continue the slate roof behind it, "
    "then retain only one small flat ivory mushroom-shaped silhouette, about 24 pixels wide, just above the center door. "
    "No circle, disk, ring, gold border, letters or extra ornament. "
    "Preserve the unmasked roofs, single barrel, open front entrance, six beds, crop positions, paths, fence, soil, "
    "camera, muted palette and background exactly. Do not add masonry under the fence or duplicate any prop."
)


def relative(path):
    return path.relative_to(REPO).as_posix()


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def prepare():
    OUT.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGB")
    if source.size != (1024, 1024):
        raise ValueError("Authored repair coordinates require the selected 1024-square raw.")
    mask = Image.new("L", source.size, 0)
    draw = ImageDraw.Draw(mask)
    for name, shape in REGIONS.items():
        if name == "small_mushroom_emblem":
            draw.ellipse(shape, fill=255)
        else:
            draw.polygon(shape, fill=255)
    # The barrel in front of the end wall is already correct and must stay intact.
    draw.rectangle((350, 540, 392, 626), fill=0)
    # A foreground bed cluster overlaps the rack's lower-right silhouette.
    draw.ellipse((267, 698, 322, 763), fill=0)
    mask = ImageChops.multiply(mask, mask.filter(ImageFilter.GaussianBlur(2)))
    mask.convert("RGB").save(MASK)
    preview = Image.composite(Image.new("RGB", source.size, "#e04455"), source,
                              mask.point(lambda value: round(value * 0.45)))
    preview.save(OUT / "mushroom_farm_repair_regions.png")
    canonical = json.loads((REPO / "tools/ai-gen/world122-building-candidate-manifest.json").read_text(encoding="utf-8"))
    asset = copy.deepcopy(next(item for item in canonical["assets"] if item["id"] == "mushroom_farm"))
    manifest = {key: copy.deepcopy(value) for key, value in canonical.items() if key != "assets"}
    manifest["outputRoot"] = relative(OUT)
    manifest["assets"] = [asset]
    asset["maskedRefineRequest"] = REQUEST
    asset["repairSource"] = relative(SOURCE)
    asset["repairMask"] = relative(MASK)
    asset["repairRegions"] = REGIONS
    asset["repairPurpose"] = "Structural correction of user-selected material direction; not an accepted final refinement."
    asset["repairDenoise"] = 0.70
    asset["repairReason"] = "Two standard Depth batches retained or introduced local geometry errors; restrict stronger repaint to these three regions and composite original pixels outside."
    save_json(OUT / "candidate-manifest.json", manifest)
    print(relative(OUT / "mushroom_farm_repair_regions.png"), flush=True)


def compose():
    source = Image.open(SOURCE).convert("RGB")
    mask = Image.open(MASK).convert("L")
    # Accepted source chain uses V02 only; V01 was rejected and archived.
    for variant in (2,):
        stem = f"mushroom_farm_refine_v{variant:02d}"
        generated = OUT / "mushroom_farm" / f"{stem}_raw.png"
        patch = Image.open(generated).convert("RGB")
        if patch.size != source.size:
            raise ValueError("Repair image dimensions differ from the source.")
        output = generated.with_name(f"{stem}_local_raw.png")
        Image.composite(patch, source, mask).save(output)
        save_json(output.with_suffix(".json"), {
            "purpose": "accepted_refinement_input_rebuild",
            "source": relative(SOURCE), "generationRaw": relative(generated),
            "generationMetadata": relative(generated.with_name(f"{stem}_generation.json")),
            "mask": relative(MASK), "maskFeatherPixels": 2,
            "operation": "Composite generated pixels only inside mask; original pixels wherever mask is zero.",
            "output": relative(output), "runtimeRole": "ancestor_of_accepted_refine_v02",
        })
        print(relative(output), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("prepare", "compose"))
    args = parser.parse_args()
    prepare() if args.action == "prepare" else compose()
