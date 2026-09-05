"""Reroll mine A using the existing Dev/Depth and alpha/lighting pipeline.

Each batch has its own immutable raw/prompt provenance; no runtime installation.
"""
import argparse
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("mine_dev_candidates", HERE / "mine-wall-a-dev-candidates.py")
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)

PROMPTS = {2: """An orthographic 2.5D game terrain asset: one solid volume of charcoal-grey excavated slate, matching the supplied depth image. The top and both side surfaces belong to the same uninterrupted rock mass. Flat broad rock surfaces carry subtle broken geological lamination and a few shallow irregular fissures. The upper and lower edges remain plain rock, with the same material continuing through them. The entire volume is one homogeneous mineral substance, with no assembled components or added structures.

Clean semi-realistic strategy-game PBR material, believable dry stone roughness, broad quiet mineral fields, sparse medium-scale wear, subdued detail at small display size. Low saturation neutral charcoal grey throughout all faces. Soft neutral upper-left top-side illumination and restrained value separation. Crisp authored silhouette, precise depth-controlled shape and camera. Preserve the supplied complete composition. Isolated on a flat uniform pure green background, with no cast shadow or surrounding scenery.
""", 3: """Orthographic game terrain render of a continuous solid mass of dark neutral grey siltstone, exactly shaped by the supplied depth image. All three visible surfaces are the same homogeneous rock. Broad quiet planes with restrained fine stone roughness, faint staggered geological striations and sparse shallow excavation scoring. The top is a calm unbroken rock surface. Subtle short irregular marks on the sides blend gently back into the surrounding stone. The same uniform mineral texture continues across upper and lower edges. Material detail is evenly distributed, softly integrated and subordinate to the large continuous shape.

Clean semi-realistic strategy-game PBR, low saturation, subdued contrast, soft neutral upper-left illumination, broad gentle shading. Readable crisp authored silhouette and exact depth-controlled camera and proportions. One isolated rock volume filling the original composition on a completely flat pure green background, without shadows or added components.
""", 4: """One rectangular volume of natural dark grey basalt rock, exactly matching the supplied depth image. A single continuous dense stone body with a planar top, planar vertical sides and intact straight edges. The same fine matte mineral material covers all surfaces. Broad softly mottled grey mineral patches give gentle natural variation, with quiet subtle stone roughness. Large continuous surfaces dominate; the upper and lower parts are identical material.

Clean semi-realistic PBR strategy-game asset, restrained texture density, low saturation neutral grey, soft neutral upper-left lighting, gentle readable shading, exact orthographic camera and silhouette from depth. Isolated on a perfectly flat pure green background, without cast shadows or added components.
"""}

# Historical batch-2 metadata referenced this name before further rerolls.
PROMPT = PROMPTS[2]


def prepare(batch):
    if any(pipeline.OUT.glob("wall_a_structure_v*_raw.png")):
        raise SystemExit("This batch already has raw outputs; keep its prompt/provenance and use a new batch.")
    pipeline.prepare()
    (pipeline.OUT / "wall_a_structure_prompt.txt").write_text(PROMPTS[batch], encoding="utf-8")
    request_path = pipeline.OUT / "request.json"
    request = json.loads(request_path.read_text(encoding="utf-8"))
    request.update({
        "batch": batch,
        "assetClass": "modular_natural_wall",
        "styleVersion": f"mine-wall-pbr-v{batch - 1}",
        "styleTemplate": f"../mine-wall-a-dev-reroll.py:PROMPTS[{batch}]",
        "styleBasis": "world122-building-v5 shared PBR, material scale, saturation and lighting; building identity and foundation clauses excluded for natural wall",
        "priorBatch": "../_mine_wall_a_dev_depth_20260830/review.json",
        "transferAuthorization": "User requested rerolls after explicitly approving this destination and Depth/prompt upload scope. No beauty or blend upload.",
    })
    pipeline.write_json(request_path, request)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("prepare", "generate", "compose"))
    parser.add_argument("--batch", type=int, default=2, choices=(2, 3, 4))
    args = parser.parse_args()
    pipeline.OUT = HERE / f"_mine_wall_a_dev_depth_20260830_batch{args.batch}"
    pipeline.SEEDS = tuple(122083000 + args.batch * 10 + offset for offset in range(3))
    if args.stage == "prepare":
        prepare(args.batch)
    elif args.stage == "generate":
        pipeline.generate()
    else:
        pipeline.compose(match_native_color=args.batch >= 3)
