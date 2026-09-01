"""Prepare one bounded alien-script sign edit on the user-preferred02 raw."""
from pathlib import Path
import json
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
PACK = HERE.parent
REPO = PACK.parents[2]
SOURCE = PACK / "trading_candidates_dev_s12_20260901/trading_company/trading_company_structure_v02_raw.png"


def relative(path):
    return path.relative_to(REPO).as_posix()


source = Image.open(SOURCE).convert("RGB")
# Inside the black sign face; the copper frame, canopy and columns stay outside.
polygon = [(721, 622), (786, 591), (786, 626), (721, 657)]
mask_large = Image.new("L", (4096, 4096), 0)
ImageDraw.Draw(mask_large).polygon([(x * 4, y * 4) for x, y in polygon], fill=255)
mask = mask_large.resize(source.size, Image.Resampling.LANCZOS)
mask.save(HERE / "sign-mask.png")
marked = Image.composite(Image.new("RGB", source.size, (240, 52, 80)), source,
                         mask.point(lambda value: round(value * .42)))
marked.save(HERE / "mask-preview.png")
marked.crop((698, 569, 808, 673)).resize((660, 624)).save(HERE / "mask-detail.png")

manifest = json.loads((PACK / "trading_candidates_dev_s12_20260901/manifest.json").read_text(encoding="utf-8"))
asset = manifest["assets"][0]
asset["primaryRequest"] = "the selected trading company's sign face with fictional alien merchant script"
asset["structureRequest"] = asset["primaryRequest"]
asset["maskedRefineRequest"] = (
    "Edit only the black face of the small copper-framed sign above the office entrance. "
    "Completely erase its cargo-box icon and outbound arrow. In their place, paint one centered row "
    "of five distinct fictional alien merchant glyphs in muted warm ivory-bronze. "
    "Use bold angular hooked and forked strokes with small diamond-like counters, "
    "varied asymmetric shapes and clear spacing, like an original nonhuman written language. "
    "These invented glyphs are intentionally requested by the user; they are not real-world readable text. "
    "Fit them to the existing tilted sign plane. Keep the dark navy-black background and existing copper "
    "frame, border thickness, sign size, perspective and position unchanged. No glow. "
    "Outside the sign face retain the complete selected02 image exactly, including its curved canopy, "
    "three office floors, gabled roofs, screen-left warehouse entrance, two crates, doors, windows and stone plinth."
)
asset["detailRequest"] = asset["maskedRefineRequest"]
asset["paletteConstraint"] = "On the sign only: muted ivory-bronze glyphs on the existing navy-black plaque, preserving its copper frame"
asset["negativeRequest"] = "no cargo box symbol, arrow symbol, Latin letters, Chinese characters, digits, real-world logo, glowing rune or second sign"
asset["modelApproval"] = "User prefers the displayed02 candidate; this request changes the sign face only, not previously noted structural differences"
asset["selectedStructureCandidate"] = relative(SOURCE)
asset["directCorrectionSource"] = relative(SOURCE)
asset["maskImage"] = relative(HERE / "sign-mask.png")
asset["maskRegions"] = [{"name": "black_sign_face_only", "polygon": polygon}]
asset["reviewStatus"] = "selected02_sign_edit_requested"
asset["approvedForRefinement"] = False
asset["finalArtApproved"] = False
manifest["assets"] = [asset]
manifest["outputRoot"] = relative(HERE)
manifest["status"] = "prepared_local_sign_edit"
manifest["refineSeedBase"] = 133240
for key in ("recommendedCandidate", "recommendationPurpose", "reviewFile", "promptGeometryClarification"):
    manifest.pop(key, None)
manifest["authorization"] = {
    "userReply": "102 更好。把门口上的招牌换成异形文字。",
    "interpretedCandidate": 2,
    "interpretationDisclosedToUser": True,
    "date": "2026-09-01",
    "scope": "One sign-face-only edit to preferred02; keep all other source pixels unchanged",
    "destination": "http://192.168.3.142:8188",
    "destinationUploadAuthorized": True,
    "standingAuthorizationRecord": "AGENTS.md#建筑管线局域网上传授权（2026-08-31）",
    "generationSubmitted": False,
    "generationCompleted": False,
    "standard48RefinementRequested": False,
    "runtimeInstallationRequested": False,
    "userTextException": "Explicit fictional alien script request supersedes the prior no-letter sign preference for this face only"
}
manifest["correctionRun"] = {
    "purpose": "Bounded local sign-content experiment, not standard48 or whole-building refinement",
    "stepsOverride": 12, "denoiseOverride": .90, "depthStrength": .75,
    "variants": 1, "maximumGeneratedImages": 1, "seed": 133241,
    "sourceImage": relative(SOURCE), "maskImage": relative(HERE / "sign-mask.png"),
    "compositePolicy": "Composite generated sign through this exact mask onto untouched source02; retain original generation separately"
}
(HERE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Prepared selected02 sign mask and one12-step masked edit")
