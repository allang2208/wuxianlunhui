"""Remove the persistent box with same-image wall texture; bounded RGB repair only."""
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
source_path = ROOT / "local_repair_v1/vehicle_factory/vehicle_factory_refine_v01_local_raw.png"
folder = ROOT / "local_repair_v4_wall_pixels"
folder.mkdir(exist_ok=True)
source = Image.open(source_path).convert("RGB")
# The donor lies above/right on the same wall plane, clear of the bay lintel.
polygon = [(694,575),(745,559),(754,570),(754,623),(706,642),(694,632)]
region = Image.new("L", source.size, 0)
ImageDraw.Draw(region).polygon(polygon, fill=255)
mask = ImageChops.multiply(region, region.filter(ImageFilter.GaussianBlur(3.5)))
donor = ImageChops.offset(source, -24, 92)
rim = ImageChops.subtract(region.filter(ImageFilter.MaxFilter(9)), region)
target_mean = ImageStat.Stat(source, rim).mean
donor_mean = ImageStat.Stat(donor, rim).mean
offsets = [max(-18, min(18, round(a-b))) for a,b in zip(target_mean, donor_mean)]
channels = [channel.point(lambda p, shift=shift: max(0, min(255, p+shift)))
            for channel, shift in zip(donor.split(), offsets)]
donor = Image.merge("RGB", tuple(channels))
repaired = Image.composite(donor, source, mask)
output = folder / "vehicle_factory_wall_repaired_raw.png"
mask_path = folder / "vehicle_factory_wall_repair_mask.png"
repaired.save(output)
mask.save(mask_path)
metadata_path = folder / "vehicle_factory_wall_repair_metadata.json"
metadata_path.write_text(json.dumps({
    "source": source_path.relative_to(REPO).as_posix(),
    "operation": "same-image concrete texture translation, bounded RGB offset and inward-feathered local composite",
    "donorOffsetFromTarget": [24,-92], "targetPolygon": polygon,
    "mask": mask_path.relative_to(REPO).as_posix(), "inwardFeatherPixels": 3.5,
    "rgbOffsets": offsets, "outsideRepair": "original source pixels retained",
    "output": output.relative_to(REPO).as_posix(), "alphaProcessing": False,
    "runtimeIntegrationActive": False,
    "reason": "Masked generative removal at Depth 0.75 and 0.15 repeatedly retained or reinvented the box. Use nearby same-plane concrete pixels; retain all unsuccessful trials for provenance."
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
selection_path = ROOT / "local-review-selection.json"
selection = json.loads(selection_path.read_text(encoding="utf-8"))
choice = selection["vehicle_factory"]
choice["repairInput"] = output.relative_to(ROOT).as_posix()
choice["repairInputMetadata"] = metadata_path.relative_to(ROOT).as_posix()
choice["reason"] = "First masked candidate restores the two-pane side window. The persistent extra panel is removed with a bounded same-image concrete texture repair; original gear geometry is retained with local material grading."
selection_path.write_text(json.dumps(selection, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(output)
