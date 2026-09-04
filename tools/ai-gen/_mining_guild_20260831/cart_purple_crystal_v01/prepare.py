"""Prepare a cargo-only revision of the user-selected mining guild 48-step02."""
import json
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REPO = ROOT.parents[2]


def relative(path):
    return path.relative_to(REPO).as_posix()


source = ROOT / "candidates_03A_dev_s48/mining_guild/mining_guild_refine_v02_raw.png"
depth = ROOT / "mining_guild_body_depth.png"
raw = Image.open(source).convert("RGB")
# Full 1024px source coordinates. The front cart rim stays outside this polygon.
polygon = [(431, 737), (450, 723), (469, 708), (482, 697), (495, 698),
           (511, 708), (520, 723), (560, 747), (555, 756), (513, 779),
           (479, 765), (456, 754), (440, 743)]
mask = Image.new("L", raw.size)
ImageDraw.Draw(mask).polygon(polygon, fill=255)
mask.save(HERE / "cargo_mask.png")
overlay = Image.blend(raw, Image.new("RGB", raw.size, (240, 40, 110)), 0.45)
overlay = Image.composite(overlay, raw, mask)
ImageDraw.Draw(overlay).line(polygon + [polygon[0]], fill=(255, 235, 80), width=1)
overlay.crop((405, 680, 590, 808)).resize((740, 512)).save(HERE / "cargo_mask_detail.png")

request = (
    "Inside the existing single wooden mining cart, replace ALL of its gray ore cargo "
    "with a compact load of solid PURPLE CRYSTALS. Every cargo piece is wholly violet "
    "crystal from base to tip, with angular flat polygonal facets, short chunky prismatic "
    "forms and a few short pointed terminations. Rich amethyst-purple faces, deep plum "
    "shadow faces and lighter lavender-purple lit facets; the whole load is purple, "
    "with absolutely NO gray rocky matrix and NO gray stones with purple spots. "
    "Keep the load approximately the original height and volume, clearly inside the "
    "cart. Retain the wooden rim, cart boards, wheels, rails and existing occlusion. "
    "Preserve the rest of the accepted mining guild exactly, including the assay table "
    "and its original samples, open doors, emblem, pennant, walls, roof and foundation. "
    "Purple crystals have restrained broad highlights without bloom or emitted light."
)
manifest = {
    "outputRoot": relative(HERE / "candidates"),
    "host": "192.168.3.142", "port": 8188, "model": "flux2-dev-depth",
    "styleVersion": "world122-building-v5",
    "styleTemplate": "tools/ai-gen/prompts/world122-building-style.md",
    "size": "1024x1024", "cfg": 3.5, "sampler": "euler", "scheduler": "simple",
    "generationTimeout": 3600, "useEdgeControl": False,
    "refineSteps": 48, "refineVariants": 1,
    "refineDenoise": 0.75, "refineDepthStrength": 0.75,
    "authorization": {
        "userRequest": "还是有点不对，矿车的矿石能否替换成纯紫色的晶石",
        "standingAuthorizationRecord": "AGENTS.md#建筑管线局域网上传授权（2026-08-31）",
        "destination": "http://192.168.3.142:8188",
        "destinationUploadAuthorized": True,
        "scope": "Cargo-only Dev masked revision: selected02 image, original Depth, local cargo mask, prompt and parameters; download result",
        "runtimeInstallationRequested": False,
    },
    "assets": [{
        "id": "mining_guild", "label": "矿业工会02 · 纯紫色晶石矿车",
        "assetClass": "mining_guild", "assetType": "World-122 mine-plane mining guild building",
        "foundationStyle": "rubble_stone", "footprintCells": 4,
        "controlImage": relative(depth), "postprocessDepthImage": relative(depth),
        "primaryRequest": "mining guild with solid purple crystal cargo inside its wooden cart",
        "structureRequest": request, "detailRequest": request, "maskedRefineRequest": request,
        "paletteConstraint": "All cart cargo is solid amethyst purple crystal with violet facets and dark plum recesses. Preserve all existing non-cargo colors and materials.",
        "negativeRequest": "gray cargo stones, rock matrix, gray rocks with purple spots, white or blue or clear crystal cargo, tall crystal towers, neon bloom, purple wooden cart boards, new props",
        "sceneBackdropRequest": "Preserve the source solid chroma green backdrop outside the complete building and foundation; no ground shadow.",
        "approvedForRefinement": True, "runtimeInstalled": False,
        "selectedRefineCandidate": relative(source),
    }],
    "localEdit": {
        "baseSelectedVariant": 2, "baseSelectedSeed": 132352,
        "source": relative(source), "mask": relative(HERE / "cargo_mask.png"),
        "polygon": polygon, "requestedSeed": 132361,
        "nonstandardReason": "Higher denoise is limited to the cargo mask to replace rock geometry with purple crystal geometry.",
        "compositionPolicy": "Copy only the local cargo patch into accepted02; preserve all other pixels and original Alpha/crop.",
    },
}
(HERE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"manifest": relative(HERE / "manifest.json"), "maskBox": mask.getbbox()}, ensure_ascii=False))
