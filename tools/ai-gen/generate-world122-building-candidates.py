#!/usr/bin/env python3
"""Generate review-only World-122 building-body candidates for the road-fill pipeline.

Outputs only to the manifest scratch directory. It never copies a candidate into assets/terrain.
Jobs are resumable: a fully produced preview is skipped on the next run.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPO / "tools/ai-gen/world122-building-candidate-manifest.json"
COMFY_PY = REPO.parent / "ComfyUI/.venv/Scripts/python.exe"
BLENDER = Path("E:/Program Files/Blender Foundation/Blender 5.1/blender.exe")
FOOTPRINT_FIT_SCALE = 1.42
CANONICAL_STYLE_VERSION = "world122-building-v4"
CANONICAL_STYLE_TEMPLATE = "tools/ai-gen/prompts/world122-building-style.md"
CANONICAL_STYLE_MARKERS = (
    "primary visual target",
    "next-generation physically plausible pbr logic optimized specifically for game readability",
    "stone retains natural medium-scale weathering",
    "wooden components show visible grain",
    "brass decoration and fittings are sparse and functional",
    "foundation routing",
    "isometric rubble stone plinth for game assets",
    "isometric fair-faced concrete plinth for modern game assets",
    "soft neutral upper-left top-side illumination",
    "balance immediate building recognition with believable realistic surface response",
    "preserve the exact authored blender geometry",
)


def run(command: list[str], *, label: str, timeout: int = 780) -> None:
    print(f"\n[{label}] {' '.join(command)}", flush=True)
    result = subprocess.run(command, cwd=REPO, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"{label} failed with exit code {result.returncode}")


def resolve_repo_file(value: str, *, label: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = REPO / path
    if not path.is_file():
        raise FileNotFoundError(f"{label} missing: {path}")
    return path


def style_contract_for(manifest: dict) -> tuple[str, str, str]:
    style_version = str(manifest.get("styleVersion", "")).strip()
    style_template = str(manifest.get("styleTemplate", "")).strip()
    if style_version != CANONICAL_STYLE_VERSION:
        raise ValueError(
            f"official building candidates require styleVersion={CANONICAL_STYLE_VERSION}; "
            f"got {style_version or '<missing>'}"
        )
    if Path(style_template).as_posix() != CANONICAL_STYLE_TEMPLATE:
        raise ValueError(
            f"official building candidates require styleTemplate={CANONICAL_STYLE_TEMPLATE}; "
            f"got {style_template or '<missing>'}"
        )
    style_path = resolve_repo_file(style_template, label="style template")
    contract = style_path.read_text(encoding="utf-8").strip()
    if not contract:
        raise ValueError(f"style template is empty: {style_path}")
    normalized_contract = contract.casefold()
    missing_markers = [
        marker for marker in CANONICAL_STYLE_MARKERS
        if marker.casefold() not in normalized_contract
    ]
    if missing_markers:
        raise ValueError(
            "canonical building style template is incomplete; missing required markers: "
            + ", ".join(missing_markers)
        )
    return style_version, style_template, contract


FOUNDATIONLESS_ASSET_CLASSES = {
    "natural_structure",
    "surface_deposit",
    "prop",
    "agricultural_compound",
}
FOUNDATION_STYLE_BY_ASSET_CLASS = {
    "modern_field_barracks": "worn_concrete",
    "modern_military_training_range": "worn_concrete",
    "modern_office": "fair_faced_concrete",
    "modern_residential": "fair_faced_concrete",
    "solar_power_station": "fair_faced_concrete",
    "modern_data_center": "fair_faced_concrete",
    "future_residential": "precast_concrete",
}
FOUNDATION_STYLES = {
    "none",
    "rubble_stone",
    "fair_faced_concrete",
    "worn_concrete",
    "precast_concrete",
}


def foundation_style_for(asset: dict) -> str:
    explicit = str(asset.get("foundationStyle", "")).strip().casefold()
    if explicit:
        if explicit not in FOUNDATION_STYLES:
            raise ValueError(
                f"unsupported foundationStyle={explicit!r} for asset {asset.get('id', '<unknown>')}"
            )
        return explicit
    asset_class = str(asset.get("assetClass", "")).strip().casefold()
    if asset_class in FOUNDATIONLESS_ASSET_CLASSES:
        return "none"
    return FOUNDATION_STYLE_BY_ASSET_CLASS.get(asset_class, "rubble_stone")


def foundation_contract_for(asset: dict) -> tuple[str, str]:
    style = foundation_style_for(asset)
    if style == "none":
        return style, (
            "Foundation exception: this asset class is not a medium functional building; preserve its "
            "authored ground contact and do not invent a building plinth, slab or pedestal."
        )
    if style == "rubble_stone":
        return style, """Foundation contract — Isometric Rubble Stone Plinth for Game Assets:
Use one low integrated medieval irregular dry-stacked rubble foundation, fully visible and completely contained inside the authored footprint. Build the surface from irregular hand-cut rubble slabs with varied stone sizing, randomized worn and beveled corners, natural filled-joint texture and a deliberately non-industrial hand-laid paving character. Give the complete outer perimeter one consistent isometric chamfer so equal-footprint assets align cleanly. Keep the plinth continuous, game-readable and materially distinct from the more regular masonry of the building body; no marble skirt, monolithic polished slab, oversized podium, detached platform or terrain patch."""
    if style == "fair_faced_concrete":
        return style, """Foundation contract — Isometric Fair-faced Concrete Plinth for Modern Game Assets:
Use one low integrated cast-in-place concrete hardstand, fully visible and completely contained inside the authored footprint. Preserve restrained formwork panel seams, fine natural air pores and a mostly level trowelled finish, with light rain streaking, localized efflorescence and subtle service wear. Keep the perimeter uniformly chamfered for clean isometric-grid joining to asphalt, concrete roads and same-spec assets. Use no medieval rubble paving, marble podium, detached platform, oversized curb or terrain patch."""
    if style == "worn_concrete":
        return style, """Foundation contract — worn plain-concrete industrial plinth:
Use one low integrated fair-faced concrete hardstand, fully visible and completely contained inside the authored footprint. Preserve formwork seams and fine air pores, then add restrained chipped corners, shallow cracks, dust, rain stains and practical industrial wear without turning the base into rubble. Keep the perimeter uniformly chamfered for clean isometric-grid joining; no medieval stone paving, marble podium, detached platform or terrain patch."""
    return style, """Foundation contract — precast concrete joining plinth:
Use one low integrated near-future precast concrete base, fully visible and completely contained inside the authored footprint. Preserve precise panel joints, fine concrete pores, a lightly polished but non-mirror finish, restrained metal edge protection and a few recessed utility channels already supported by the authored geometry. Keep the perimeter uniformly chamfered for clean isometric-grid joining; no medieval rubble paving, neon seams, floating slab, detached platform or terrain patch."""


def prompt_for(asset: dict, manifest: dict, stage: str = "legacy",
               masked_refine: bool = False) -> str:
    natural_structure = asset.get("assetClass") == "natural_structure"
    surface_deposit = asset.get("assetClass") == "surface_deposit"
    prop_asset = asset.get("assetClass") == "prop"
    wind_power_station = asset.get("assetClass") == "wind_power_station"
    # The industrial class includes several unrelated buildings.  The open
    # derrick/bore vocabulary is specific to deep_drill and must never leak
    # into wind, steam or other industrial assets.
    deep_drill = asset.get("id") == "deep_drill"
    solar_power_station = asset.get("assetClass") == "solar_power_station"
    modern_data_center = asset.get("assetClass") == "modern_data_center"
    modern_field_barracks = asset.get("assetClass") == "modern_field_barracks"
    modern_military_training_range = asset.get("assetClass") == "modern_military_training_range"
    roman_barracks = asset.get("assetClass") == "roman_barracks"
    agricultural_compound = asset.get("assetClass") == "agricultural_compound"
    modern_office = asset.get("assetClass") == "modern_office"
    victorian_residential = asset.get("assetClass") == "victorian_residential"
    modern_residential = asset.get("assetClass") == "modern_residential"
    future_residential = asset.get("assetClass") == "future_residential"
    phase_storage_warehouse = asset.get("assetClass") == "phase_storage_warehouse"
    if stage == "structure":
        request = asset.get("structureRequest", asset["primaryRequest"])
    elif stage == "refine":
        request = (asset.get("maskedRefineRequest") if masked_refine else None) \
            or asset.get("detailRequest", asset["primaryRequest"])
    else:
        request = asset["primaryRequest"]
    request_prefix = "" if modern_military_training_range else "exactly one "
    if stage == "structure" and prop_asset:
        stage_contract = """Generation stage: structural prop draft only
Structure contract: preserve the supplied treasure-chest body, domed lid, four feet, frame, lock and authored open-or-closed lid state as one portable object; every hardware component remains attached to the same chest
Detail budget: use broad readable metal panels, frame bands, lock plate, medallion and handle shapes so the chest silhouette and lid state can be judged; omit tiny engraving that would collapse at game scale"""
    elif stage == "structure" and agricultural_compound:
        stage_contract = """Generation stage: structural agricultural-compound draft only
Structure contract: preserve one complete broad low 4x4 pasture, one continuous post-and-rail perimeter fence with one centered open gate, exactly one small central dairy hall, exactly one connected open cowshed and exactly one connected enclosed cheese workshop; keep the three-building cluster near one quarter of the pasture area and leave the remaining pasture visibly open
Detail budget: use broad readable grass, timber, stone, plaster, roof, thatch, cheese-press and aging-rack materials so the compound layout can be judged; omit tiny clutter, animals, workers, carts and decorative scenery"""
    elif stage == "structure" and solar_power_station:
        stage_contract = """Generation stage: structural photovoltaic-station draft only
Structure contract: preserve one complete 4x4 foundation, exactly one connected two-storey flat-roof office at the rear-right, exactly eighteen aligned ground panels in the front 3x6 block, exactly nine aligned ground panels in the rear-left 3x3 block, exactly four aligned roof panels in one 2x2 block and exactly two attached inverter cabinets; every photovoltaic panel follows the same authored global lattice, pitch and row direction
Detail budget: use broad readable concrete, mineral plaster, charcoal steel, deep blue photovoltaic glass, aged brass and restrained cyan indicator materials so the full panel field, exact two-storey office and attached power equipment can be judged; omit tiny controls, cables, lettering, people, vehicles and decorative scenery"""
    elif stage == "structure" and modern_data_center:
        stage_contract = """Generation stage: structural modern-data-center draft only
Structure contract: preserve one complete 4x4 foundation, one exact four-storey central operations core, exactly two attached symmetric two-storey server wings, exactly two roof cooling banks with three radiator cassettes each, exactly two wall-mounted coolant tanks, paired low wide coolant trunks and one attached low central roof manifold; every floor stays a closed load-bearing mass and every cooling device remains bolted to the same connected facility
Detail budget: use broad readable weathered concrete, mineral panels, charcoal steel, deep blue-green server glazing, aged brass and restrained cyan coolant so the exact floor counts, server wings, cooling banks, tanks, trunks, lobby and processor emblem can be judged; omit office furniture, loose server racks, people, vehicles, lettering and tiny sci-fi greebles"""
    elif stage == "structure" and modern_military_training_range:
        stage_contract = """Generation stage: structural modern-military-training-range draft only
Structure contract: preserve one complete 2x2 foundation, exactly one low attached control building and one open four-post firing line under one uninterrupted flat roof, exactly three separated concrete firing lanes, exactly three fixed steel silhouette targets on one shared carrier rail, one connected reinforced backstop with two short side wings, three attached ammunition lockers and the authored ordered ammunition groups; every component stays grounded inside the same compact facility
Detail budget: use broad readable worn concrete, dark olive painted metal, charcoal steel, restrained blue-green glass and muted safety hardware so the single roof, control room, three lanes, three targets, backstop and organized supplies can be judged; omit troops, firearms, vehicles, perimeter fencing, towers, lettering and random loose clutter"""
    elif stage == "structure" and modern_field_barracks:
        stage_contract = """Generation stage: structural modern-field-barracks draft only
Structure contract: preserve one complete 2x2 foundation, exactly one compact connected olive ridge tent with one open tied-back entrance and two rolled windows, exactly one attached open four-post steel lookout tower with cross braces, observation deck, railings, fixed ladder and one small canvas canopy, exactly two short low sandbag stacks, one short connector landing, one three-crate ammunition stack, one two-crate and two-jerry-can supply group, and one tower-side radio and cable-spool service group; every tower component and equipment group remains grounded and physically joined to the same compact field compound
Detail budget: use broad readable canvas, webbing, weathered steel, dusty concrete, dark glass, sandbag cloth and olive equipment paint so the single tent, single tower, entrance, ladder, connector and three organized equipment zones can be judged; omit troops, vehicles, weapons, fences, lettering and random loose field clutter"""
    elif stage == "structure" and roman_barracks:
        stage_contract = """Generation stage: structural Roman-barracks draft only
Structure contract: preserve one complete 2x2 foundation, exactly one low connected rectangular barracks hall with one complete flat stone roof deck and low side and rear parapets, exactly two attached symmetric flat-topped square corner towers, one connected front curtain wall, one centered arched gatehouse, complete authored crenellated parapets and exactly two matching crimson Roman legion standards; the gate opening remains visible and every tower, wall and gatehouse intersects the same compact fort
Detail budget: use broad readable weathered stone, warm mineral plaster, dark timber, blackened iron, aged brass and crimson cloth so the Roman military silhouette, flat roof, battlements, arch, two scuta and two standards can be judged; omit roof tiles, people, siege engines, loose weapons, lettering and tiny ornament"""
    elif stage == "structure" and wind_power_station:
        stage_contract = """Generation stage: structural wind-power-station body draft only
Structure contract: preserve one complete 2x2 foundation, one connected low rectangular stone-and-half-timber generator hall, one continuous gabled roof, one short four-post open iron lattice tower with complete cross braces, one horizontal fixed nacelle facing the authored front direction, one exposed fixed axle collar with no rotor blades, one attached side generator flywheel, one transfer shaft and exactly two attached cyan energy buffers; every component remains physically joined to the same compact station
Detail budget: use broad readable stone, plaster, timber, blue-gray slate, blackened iron, oxidized brass and restrained cyan energy materials so the hall, tower, nacelle, axle, flywheel and two buffers can be judged; omit blades, sails, tiny gauges, lettering and decorative filigree"""
    elif stage == "structure" and deep_drill:
        stage_contract = """Generation stage: structural open-machine building draft only
Structure contract: preserve one connected open four-post derrick, its cross braces and roof canopy, the central bore and drill shaft, one attached side winch, one attached extraction manifold and the authored maintenance clutter; the spaces between the posts remain visibly open and every machine stays bolted to the same deck
Detail budget: use broad readable timber, iron, brass, stone and energy-flow materials so the derrick, bore, winch, manifold, tool chest, spare pipes and spare drill bits can be judged; omit tiny gauges, lettering and decorative filigree"""
    elif stage == "structure" and surface_deposit:
        stage_contract = """Generation stage: structural surface-deposit draft only
Structure contract: preserve one complete very shallow diamond-shaped rubble bed and the authored flat embedded ore plates; all four footprint corners remain visible; every element stays below knee height and there is no opening, entrance, arch, support, rail, wall or roof
Detail budget: use broad readable fractured stones, low rubble clusters and wide partially buried ore faces so the footprint and vein layout can be judged; omit architecture, excavation infrastructure and tall crystal silhouettes"""
    elif stage == "structure" and natural_structure:
        stage_contract = """Generation stage: structural massing draft only
Structure contract: create one low connected natural rock mound with exactly one authored cave opening; preserve the supplied support frame, arch and rails without adding any inhabited architecture; all rock masses remain solid and mutually intersecting
Detail budget: use plain readable rock, timber and iron materials so the single opening, mound silhouette and attached supports can be judged; omit windows, doors, roofs, rooms, towers, signs and ornament"""
    elif stage == "structure" and modern_office:
        stage_contract = """Generation stage: structural modern-office draft only
Structure contract: preserve one complete 4x4 foundation and exactly six vertically aligned connected storeys; keep the broad recessed glass lobby, repeated office curtain-wall bays, dark structural fins, flat roof slab, continuous low parapet and attached low roof crown; every floor remains a closed load-bearing mass behind its glazing
Roof-equipment contract: preserve exactly one compact open-lattice communications antenna tower bolted to the roof crown, including its four-legged mount, cross braces, crossarm, three panel antennas and lightning rod; it is not a seventh storey or inhabited tower
Detail budget: use broad readable cool stone, pale mineral wall panels, dark steel, blue-green glass, sparse amber glass and aged brass so the exact floor count, lobby, window rhythm, sign, flat roof and antenna silhouette can be judged; omit office furniture, people, vehicles, readable ticker text and any unmodelled rooftop equipment"""
    elif stage == "structure" and victorian_residential:
        stage_contract = """Generation stage: structural Victorian-residential draft only
Structure contract: preserve one complete 2x2 foundation and exactly four connected readable storeys; keep one attached two-storey bay window, one attached wrought-iron balcony, one compact domestic steam riser with gauge, one continuous mansard-hipped roof, exactly one dormer and exactly one chimney; every wall and floor remains a closed inhabited residential mass
Detail budget: use broad readable brick, aged cream stone-plaster, dark timber, wrought iron, old brass, slate and restrained amber glass so the four-storey townhouse silhouette can be judged; omit factory machinery, industrial pipe networks, workers, vehicles, text and loose street props"""
    elif stage == "structure" and modern_residential:
        stage_contract = """Generation stage: structural modern-residential draft only
Structure contract: preserve one complete 2x2 foundation and exactly five connected vertically aligned residential storeys; keep the broad glass lobby, repeated apartment-window rhythm, exactly four attached staggered balconies, one flat roof with continuous low parapet, one attached low mechanical penthouse and exactly two roof solar panels
Detail budget: use broad readable mineral plaster, warm-gray concrete, charcoal steel, blue-green residential glass, muted bronze and restrained balcony planting so the exact floor count and domestic character can be judged; omit office signage, commercial curtain-wall grids, vehicles, people and extra rooftop equipment"""
    elif stage == "structure" and future_residential:
        stage_contract = """Generation stage: structural future-residential draft only
Structure contract: preserve one complete 2x2 foundation and exactly six independently readable curved elliptical residential floors with the authored alternating offsets and rotations; keep one continuous central oval tower core, curved glass ribbons, exactly three attached crescent sky gardens at levels two, four and six, one attached glass observation crown, one compact energy halo and exactly four roof solar petals; preserve the supplied arcs instead of rectangularizing the mass
Detail budget: use broad readable ceramic composite, charcoal structural bands, restrained blue-green glass, aged champagne bronze and deep vegetation so the six curved levels, central core and three sky gardens can be judged; omit extra floors, detached pods, flying vehicles, text and tiny sci-fi greebles"""
    elif stage == "structure" and phase_storage_warehouse:
        stage_contract = """Generation stage: structural phase-storage warehouse draft only
Structure contract: preserve one complete 2x2 four-storey connected medieval warehouse, one continuous steep gable roof, exactly two unobstructed ground loading doors, two inherited balconies, exactly one exterior cargo lift, exactly one enclosed sorter, one short conveyor, one routing manifold, two enclosed chutes, two receiving bins and one attached phase-vault assembly; that assembly has exactly one faceted core inside exactly one complete stabilizer ring, exactly two sealed reserve canisters, four ring clamps, one short crossfeed conduit and one direct sorter coupler
Detail budget: use broad readable half timber, plaster, fieldstone, roof tile, blackened iron and dark tarnished brass materials so the warehouse hierarchy and single phase-vault assembly can be judged; only the one large faceted core may be cyan, while canisters, coupler and all other hardware remain non-luminous dark metal"""
    elif stage == "structure":
        stage_contract = """Generation stage: structural massing draft only
Structure contract: create closed, continuous, solid architecture; preserve the exact count and placement of the main hall, roof masses and towers from the supplied controls; every tower wall must intersect the supporting roof or hall; all tower corners, roof faces and lower walls must be complete; windows are shallow closed recesses, never open holes
Detail budget: omit telescopes, armillary spheres, books, signs, pipes, furniture and small ornaments; use plain readable stone, timber and roof materials so structural completeness can be judged"""
    elif stage == "refine" and prop_asset:
        stage_contract = """Generation stage: detail refinement of the supplied initial prop image
Structure contract: preserve the initial image's exact chest proportions, lid angle, lock placement, medallion, handle, camera, center and ground-contact points; do not add, move, merge or remove any major chest component
Detail budget: improve only blackened metal response, aged brass relief, restrained filigree, edge wear, hinges and dark interior lining"""
    elif stage == "refine" and agricultural_compound:
        stage_contract = """Generation stage: detail refinement of the supplied agricultural-compound image
Structure contract: preserve the initial image's exact 4x4 pasture boundary, complete fence, centered open gate, small three-building cluster, broad empty grazing area, camera, center and ground-contact corners; do not add, move, enlarge, merge or remove any major component
Detail budget: improve only pasture texture, weathered timber, fieldstone, plaster, roof tiles, cowshed thatch, cheese press, aging rack and restrained cheese-wheel surfaces"""
    elif stage == "refine" and solar_power_station:
        stage_contract = """Generation stage: detail refinement of the supplied photovoltaic-station image
Structure contract: preserve the initial image's exact full 4x4 foundation, one exact two-storey rear-right office, front 3x6 ground-panel block, rear-left 3x3 ground-panel block, roof 2x2 panel block, two attached inverter cabinets, camera, center and ground-contact corners; do not add, move, rotate, stagger, merge or remove any panel, floor or major equipment component
Detail budget: improve only weathered concrete and mineral plaster, charcoal frames, deep blue photovoltaic glass with broad cell divisions, restrained office glazing, aged brass sun emblem, inverter surfaces and tiny cyan status indicators"""
    elif stage == "refine" and modern_data_center:
        stage_contract = """Generation stage: detail refinement of the supplied modern-data-center image
Structure contract: preserve the initial image's exact full 4x4 foundation, four-storey central core, two attached two-storey server wings, two three-cassette roof cooling banks, two wall-mounted coolant tanks, paired low cooling trunks, central manifold, lobby, processor emblem, camera, center and ground-contact corners; do not add, remove, move, merge or reinterpret any floor, wing or cooling component
Detail budget: improve only weathered concrete and mineral panels, charcoal steel, server glazing, intake grilles, aged brass, restrained coolant surfaces and dim interior light"""
    elif stage == "refine" and modern_military_training_range:
        stage_contract = """Generation stage: detail refinement of the supplied modern-military-training-range image
Structure contract: preserve the initial image's exact 2x2 footprint, single attached control building, one uninterrupted flat roof, four firing-line posts, exactly three concrete lanes, exactly three steel silhouette targets, shared carrier rail, connected backstop with two short wings, three ammunition lockers, four authored perimeter supply groups, camera, center and ground-contact corners; do not add, remove, duplicate, move, merge or reinterpret any major component or equipment group
Detail budget: improve only worn concrete, dark olive paint, charcoal steel, restrained blue-green glazing, muted safety hardware, reinforced ammunition crates and subtle service wear"""
    elif stage == "refine" and modern_field_barracks:
        stage_contract = """Generation stage: detail refinement of the supplied modern-field-barracks image
Structure contract: preserve the initial image's exact 2x2 footprint, single compact ridge tent, one tied-back entrance, two rolled windows, single four-post lookout tower, cross braces, deck, railings, ladder, canvas canopy, two low sandbag stacks, connector landing, authored three-crate ammunition stack, two-crate and two-jerry-can supply group, tower-side radio and cable spool, camera, center and ground-contact corners; do not add, remove, duplicate, move, merge or reinterpret any major component or equipment group
Detail budget: improve only olive canvas weave and seams, dark webbing, weathered charcoal steel, dusty concrete, worn sandbag cloth, olive equipment paint, restrained dark glass and sparse amber utility light"""
    elif stage == "refine" and roman_barracks:
        stage_contract = """Generation stage: detail refinement of the supplied Roman-barracks image
Structure contract: preserve the initial image's exact 2x2 footprint, one low connected barracks hall, one complete flat stone roof deck with low side and rear parapets, two flat-topped square corner towers, connected front curtain wall, centered arched gatehouse, all authored battlements, exactly two tower scuta, exactly two crimson legion standards, camera, center and ground-contact corners; do not add, remove, duplicate, move, merge or reinterpret any major component, flag or crenellation group
Detail budget: improve only weathered limestone and fieldstone, warm mineral plaster, dark timber, blackened iron, aged brass, crimson cloth, shield surfaces and restrained amber gate light"""
    elif stage == "refine" and wind_power_station:
        stage_contract = """Generation stage: detail refinement of the supplied wind-power-station static body
Structure contract: preserve the initial image's exact complete 2x2 foundation, connected low generator hall, continuous gabled roof, short open four-post lattice tower, horizontal nacelle direction, exposed fixed axle collar, absent rotor blades, attached side flywheel, transfer shaft, exactly two energy buffers, camera, center and ground-contact points; do not add, remove, duplicate, move, rotate, merge or reinterpret any major component
Detail budget: improve only weathered stone, aged plaster, worn timber, muted blue-gray slate, blackened iron, oxidized brass and restrained cyan energy surfaces"""
    elif stage == "refine" and deep_drill:
        stage_contract = """Generation stage: detail refinement of the supplied initial open-machine building image
Structure contract: preserve the initial image's exact four-post derrick, open sides, roof canopy, central bore and shaft, side winch, extraction manifold, maintenance clutter, camera, center and ground-contact points; do not enclose the frame or add, move, merge or remove any major machine component
Detail budget: improve only weathered timber, blackened iron, oxidized brass, worn stone, restrained cyan energy flow and practical maintenance-tool surfaces"""
    elif stage == "refine" and surface_deposit:
        stage_contract = """Generation stage: detail refinement of the supplied initial surface-deposit image
Structure contract: preserve the initial image's exact low diamond footprint, four readable corners, flat ore layout, camera, center and ground-contact edge; do not add height, a cave, an entrance, architecture or excavation equipment
Detail budget: improve only fractured-stone variation, chipped flat ore faces, restrained energy seams, dust and subtle contact occlusion"""
    elif stage == "refine" and natural_structure:
        stage_contract = """Generation stage: detail refinement of the supplied initial image
Structure contract: preserve the initial image's exact single cave opening, natural rock silhouette, support frame, rails, camera, center and ground-contact edge; do not add, move or reinterpret any rock mass as architecture
Detail budget: improve only rock weathering, arch masonry, timber grain, iron wear, rails and the specifically requested embedded crystals"""
    elif stage == "refine" and modern_office:
        stage_contract = """Generation stage: detail refinement of the supplied modern-office image
Structure contract: preserve the initial image's exact 4x4 foundation, six-storey count, vertically aligned facade, lobby, office-window rhythm, flat parapet roof, attached low crown, sign, camera, center and ground-contact corners; do not rebuild, move, merge, remove or add any major architectural mass
Roof-equipment contract: preserve the exact single roof-mounted lattice antenna tower, crossarm, three antenna panels and lightning rod from the initial image; do not remove, duplicate, enclose or turn it into an occupied floor
Detail budget: improve only weathered cool stone, pale mineral panels, charcoal steel facade and antenna lattice, blue-green and amber glazing, aged brass hardware and lightning rod, restrained interior office light and the no-text opening-bell plus rising-chart emblem"""
    elif stage == "refine" and victorian_residential:
        stage_contract = """Generation stage: detail refinement of the supplied Victorian-residential image
Structure contract: preserve the initial image's exact 2x2 foundation, four-storey count, attached two-storey bay, single balcony, domestic steam riser and gauge, mansard-hipped roof, one dormer, one chimney, camera, center and ground-contact corners; do not add, remove or rebuild any major architectural mass
Detail budget: improve only aged brick, cream stone-plaster, dark timber, wrought iron, oxidized copper, old brass, slate, amber glazing and restrained domestic steam fittings"""
    elif stage == "refine" and modern_residential:
        stage_contract = """Generation stage: detail refinement of the supplied modern-residential image
Structure contract: preserve the initial image's exact 2x2 foundation, five-storey count, glass lobby, apartment-window rhythm, four attached balconies, flat parapet roof, low mechanical penthouse, two solar panels, camera, center and ground-contact corners; do not add, remove or rebuild any major architectural mass
Detail budget: improve only weathered mineral plaster, warm-gray concrete, charcoal steel, blue-green glazing, muted bronze, residential interior light and restrained balcony planting"""
    elif stage == "refine" and future_residential:
        stage_contract = """Generation stage: detail refinement of the supplied future-residential image
Structure contract: preserve the initial image's exact 2x2 foundation, six curved elliptical floor plates and their alternating offsets, central oval tower core, curved glazing, three crescent sky gardens at levels two, four and six, glass observation crown, energy halo, four solar petals, camera, center and ground-contact corners; do not straighten, rectangularize, add, remove or detach any major mass
Entrance correction contract: preserve exactly one closed ground-level entrance in the authored lower facade; replace its round porthole-like infill with two solid flush automatic door leaves sliding inward from left and right to meet at one crisp vertical center seam, with one restrained upper track and one lower guide; the entrance stays closed and attached directly to the facade with no open gap, ramp, bridge, glowing path or projecting platform; completely erase any duplicated upper round portal and rebuild that region as a closed uninterrupted horizontal curved residential glass ribbon plus continuous structural bands, with no opening, arch, recess, door or portal
Detail budget: improve only off-white ceramic composite, charcoal bands, restrained blue-green glass, champagne bronze, deep vegetation, subtle residential light, the single bi-parting automatic entrance and physically integrated energy hardware"""
    elif stage == "refine" and phase_storage_warehouse:
        stage_contract = """Generation stage: detail refinement of the supplied phase-storage warehouse image
Structure contract: preserve the initial image's exact 2x2 footprint, four connected storeys, one continuous gable roof, exactly two ground loading doors, two balconies, exactly one cargo lift, exactly one enclosed sorter, one short conveyor, one routing manifold, two enclosed chutes, two receiving bins and one attached phase-vault assembly; preserve exactly one large faceted core inside exactly one complete stabilizer ring, exactly two sealed reserve canisters, four ring clamps, one short crossfeed conduit, one direct sorter coupler, camera, center and ground-contact edge; do not add, remove, duplicate, relocate or reinterpret any architectural or mechanical component
Color-isolation contract: the one large faceted phase core inside the single ring is the only cyan or blue luminous object anywhere in the image; both reserve canisters are sealed opaque blackened-iron cylinders with dark tarnished-brass collars, and the lower coupler is non-luminous blackened iron and brown-brass hardware with no blue liquid, lens, crystal, halo or ring
Detail budget: match the accepted warehouse LV4 family's restrained darkness and weathering; improve only muted gray-purple roof tiles, aged cream plaster, dark-oak grain and joints, chipped fieldstone, matte worn iron, subdued brown tarnished brass with minimal highlights, restrained edge wear and the single controlled cyan core surface; keep contrast neutral and avoid clean laboratory glass, bright gold, polished metal or broad glow"""
    elif stage == "refine":
        stage_contract = """Generation stage: detail refinement of the supplied initial image
Structure contract: preserve the initial image's exact building silhouette, tower count, tower placement, roofline, camera, center and ground-contact edge; do not rebuild, move, merge, remove or add any major architectural mass
Detail budget: improve only materials, masonry courses, roof tiles, windows and the specifically requested scholarly details; keep all existing walls solid and continuous"""
    else:
        stage_contract = """Generation stage: single-pass legacy candidate
Structure contract: preserve every major component indicated by the control silhouette; do not omit, merge, flatten or replace any supplied component"""
    palette_contract = ""
    if asset.get("paletteConstraint"):
        palette_contract = f"Palette lock: {asset['paletteConstraint']}\n"
    style_scope = ""
    if asset.get("styleScopeRequest"):
        style_scope = f"Asset-specific style scope: {asset['styleScopeRequest']}\n"
    negative_request = ""
    if asset.get("negativeRequest"):
        negative_request = f"Asset-specific absolute exclusions: {asset['negativeRequest']}\n"
    footprint_cells = int(asset.get("footprintCells", 2))
    footprint_contract = (
        f"runtime {footprint_cells}x{footprint_cells} isometric footprint"
        if footprint_cells != 2 else "runtime 2x2 road-tile fill"
    )
    asset_type = asset.get("assetType", "World-122 RTS building body")
    if prop_asset:
        composition_contract = "strictly follow the supplied depth-control silhouette and orthographic 2.5D isometric view; centered; all four authored feet remain grounded; preserve the exact open-or-closed lid state; no perspective convergence"
        negative_contract = "one portable treasure chest only; no house, no building facade, no roof reinterpretation, no tower, no room, no wall, no window, no door, no platform, no pedestal, no floor tile, no terrain, no cast shadow, no treasure pile, no coins, no weapons, no people, no animals, no text and no watermark"
    elif agricultural_compound:
        composition_contract = "strictly follow the supplied full-compound depth-control silhouette and orthographic 2.5D isometric view; centered; all four pasture corners and the complete fence remain visible; the centered gate stays open; the small main hall, cowshed and workshop remain grounded inside the rear portion while most of the pasture stays open; no perspective convergence"
        negative_contract = "one complete medieval dairy-farm compound only; no enlarged building cluster, no extra farmhouse, no detached barn, no second cowshed, no second workshop, no silo, no windmill, no tower, no castle, no market stall, no cart, no wagon, no machinery beyond the supplied cheese press, no extra fence, no road, no stairs, no raised stone platform, no marble plinth, no trees, no crops, no people, no hamsters, no cowherds, no cows, no other animals, no signs, no readable text and no watermark; do not fill the broad pasture with loose clutter or scenery"
    elif solar_power_station:
        composition_contract = "strictly follow the supplied full 4x4 depth-control silhouette and orthographic 2.5D isometric view; centered; preserve one exact two-storey office at the rear-right; preserve the front 3x6 and rear-left 3x3 ground-panel blocks on one shared straight lattice plus one roof 2x2 block; all panel frames retain one common pitch, row direction, spacing and edge alignment; no perspective convergence"
        negative_contract = "one connected modern photovoltaic power station only; no staggered, crooked, randomly rotated or missing panels, no extra panel beyond the supplied silhouette, no oversized gaps or empty lawn within the authored panel field, no third floor, extra office wing, detached annex, second building, pitched roof, tower, antenna, satellite dish, smokestack, cooling tower, wind turbine, generator hall, road, cars, trucks, plaza furniture, fences, trees, people, animals, readable text, numbers, logos or watermark"
    elif modern_data_center:
        composition_contract = "strictly follow the supplied full 4x4 depth-control silhouette and orthographic 2.5D isometric view; centered; all four foundation corners remain visible; preserve one exact four-storey central operations core, exactly two attached symmetric two-storey server wings, exactly two roof cooling banks with three radiator cassettes each, exactly two wall-mounted coolant tanks, paired low wide coolant trunks and one attached low central roof manifold; no perspective convergence"
        negative_contract = "one connected modern computing facility only; no fifth floor, no third wing floor, no antenna, satellite dish, tower, spire, dome, pitched roof, detached annex, second building, cooling tower, smokestack, solar panels, wind turbine, floating machinery, loose server cabinets, road, cars, plaza furniture, trees, people, readable text, numbers, logos or watermark; the processor sign stays one geometric nine-node emblem"
    elif modern_military_training_range:
        composition_contract = "strictly follow the supplied full 2x2 depth-control silhouette and orthographic 2.5D isometric view; centered; all four foundation corners remain visible; preserve one low attached control room and one open four-post firing line under one uninterrupted flat roof, exactly three separated concrete lanes, exactly three fixed steel silhouette targets, one shared carrier rail, one connected backstop and the authored ordered ammunition groups; no perspective convergence"
        negative_contract = "one compact present-day military firing range only; no second roof, second building, extra floor, tower, guard post, fourth target, extra lane, detached bunker, chain-link perimeter, barbed wire, vehicle, radar, antenna, soldiers, hamsters, people, animals, loose firearms, national insignia, readable text, neon, sci-fi machinery, road, terrain, trees, cast shadow, ground shadow, backdrop shadow, green-screen shadow gradient or watermark"
    elif modern_field_barracks:
        composition_contract = "strictly follow the supplied full 2x2 depth-control silhouette and orthographic 2.5D isometric view; centered; all four foundation corners remain visible; preserve exactly one compact military ridge tent, exactly one attached open four-post lookout tower with its authored deck, canopy and ladder, and exactly three organized equipment zones: a three-crate ammunition stack, a two-crate and two-jerry-can supply group, and a tower-side radio with cable spool; the entrance and ladder remain clear and every component stays connected to the same compact compound; no perspective convergence"
        negative_contract = "one compact present-day infantry field barracks only; no medieval stone hall, half-timber facade, red tile roof, castle battlements, second tent, second tower, detached hut, bunker, perimeter fence, chain-link fence, barbed wire, camouflage-net canopy, obstacle course, radar, antenna mast, flag, soldiers, hamsters, people, guns, turret, tank, armored vehicle, truck, helicopter, national insignia, readable text, neon, sci-fi machinery, random or scattered clutter, extra crates or extra fuel cans, road, terrain, trees or watermark"
    elif roman_barracks:
        composition_contract = "strictly follow the supplied full 2x2 depth-control silhouette and orthographic 2.5D isometric view; centered; all four foundation corners remain visible; preserve exactly one low Roman barracks hall with one complete flat stone roof deck and low side and rear parapets, exactly two symmetric flat-topped crenellated corner towers, one connected front curtain, one centered arched gatehouse and exactly two matching crimson legion standards; the gate remains readable and every fortified element stays physically joined; no perspective convergence"
        negative_contract = "one compact medieval Roman legion barracks only; no pitched roof, gable roof, red tiled roof, pointed tower roof, conical turret, Gothic spire, half-timber facade, cathedral window, third tower, second hall, second roof, detached wall, detached gate, courtyard expansion, amphitheater, palace, temple, aqueduct, colonnade forest, siege engine, ballista, catapult, vehicle, modern machinery, soldiers, hamsters, people, animals, loose weapons, extra flag, national flag, readable Latin letters, words, numerals, runes, neon, road, terrain, trees or watermark"
    elif wind_power_station:
        composition_contract = "strictly follow the supplied full 2x2 depth-control silhouette and orthographic 2.5D isometric view; centered; all four foundation corners remain visible; preserve one low generator hall, one short open four-post tower with vertical posts and complete cross braces, one horizontal nacelle facing the authored front direction and one exposed fixed circular axle collar; the axle is empty and carries no rotor blades; every structural and mechanical component stays connected; no perspective convergence"
        negative_contract = "one compact medieval magitech wind power station static body only; no rotor blade, turbine blade, propeller, sail, windmill sail, wheel mounted on the top axle, second rotor, extra turbine, wind farm, tall tower, modern tubular mast, detached machinery, second building, chimney, cooling tower, solar panel, road, terrain, grass, people, animals, signs, text, watermark, cast shadow, ground shadow, backdrop shadow or green-screen shadow gradient; the required plinth must remain fully visible inside the supplied footprint and must not become a detached slab or oversized podium"
    elif deep_drill:
        composition_contract = "strictly follow the supplied depth-control silhouette and orthographic 2.5D isometric view; centered; all four derrick feet remain grounded on the same machine deck; posts remain vertical and open spaces remain open; every machine and maintenance object stays attached to the authored structure; no perspective convergence"
        negative_contract = "one connected open medieval deep-drilling building on exactly one routed low rubble-stone plinth only; no enclosed house, no factory hall, no solid walls between the derrick posts, no second building, no second tower, no oil pumpjack, no oil well, no modern steel lattice tower, no crane boom, no smokestack, no cooling tower, no extra roof, no second platform, no detached machinery, no pipes extending beyond the supplied silhouette, no road, no stairs, no terrain, no grass, no trees, no people, no animals, no signs, no text and no watermark; the required plinth must remain inside the supplied footprint and must not become a detached slab, oversized podium or cast shadow"
    elif surface_deposit:
        composition_contract = "strictly follow the supplied depth-control silhouette and orthographic 2.5D isometric view; centered; preserve one complete shallow projected 128x64 diamond with all four corners readable; every rubble and ore element remains low, grounded and inside that diamond; no perspective convergence"
        negative_contract = "one bare surface mineral deposit only; no cave, no hole, no tunnel, no entrance, no portal, no arch, no doorway, no mountain, no cliff, no hill, no tall mound, no building, no house, no tower, no wall, no roof, no timber frame, no fence, no scaffolding, no bridge, no rail, no track, no cart, no machinery, no upright crystal, no pointed crystal, no spire, no pillar, no raised platform, no road, no stairs, no cast shadow, no grass, no trees, no people, no animals, no text and no watermark"
    elif natural_structure:
        composition_contract = "strictly follow the supplied depth-control silhouette and orthographic 2.5D isometric view; centered; the rock mound ends exactly at the supplied ground line; attached timber posts remain vertical; no perspective convergence"
        negative_contract = "one natural rock structure only; exactly one cave opening and one entrance arch; no house, no tower, no upper floor, no roof, no facade, no window, no stained glass, no door, no chapel, no gatehouse, no second entrance, no extra arch, no detached building, no square floor, no paving, no road slab, no plinth, no pedestal, no cast shadow, no grass, no trees, no people, no animals, no flags, no text and no watermark"
    elif modern_office:
        composition_contract = "strictly follow the supplied full 4x4 depth-control silhouette and orthographic 2.5D isometric view; centered; all four foundation corners remain visible; exactly six vertically aligned storeys remain closed and connected; curtain-wall bays, lobby, flat roof and parapet follow the authored axes; preserve exactly one compact open-lattice communications antenna tower physically mounted on the attached roof crown; no perspective convergence"
        negative_contract = "one connected six-storey modern-fantasy financial office building with exactly one authored roof antenna tower only; no medieval half-timber facade, no pitched roof, no inhabited tower, no spire, no dome, no seventh floor, no rooftop terrace, no second antenna tower, no satellite dish, no detached annex, no second building, no skybridge, no exposed utility pipes, no smokestack, no futuristic machinery, no mirror-chrome skyscraper, no neon billboard, no road, no cars, no plaza furniture, no trees, no people, no animals, no flags, no readable letters, words, numbers, runes, ticker text or watermark; all signs use only the supplied geometric bell, coin and rising-chart symbols"
    elif victorian_residential:
        composition_contract = "strictly follow the supplied full 2x2 depth-control silhouette and orthographic 2.5D isometric view; centered; all four foundation corners remain visible; exactly four connected residential storeys, the attached two-storey bay, one balcony, compact steam riser, mansard-hipped roof, one dormer and one chimney remain physically joined; no perspective convergence"
        negative_contract = "one compact four-storey Victorian steam-era townhouse only; no factory, boiler house, mill, warehouse, smokestack cluster, industrial pipe network, second house, detached annex, second roof, second dormer, second chimney, tower, turret, palace wing, fifth floor, modern curtain wall, futuristic parts, road, cars, fence, trees, people, animals, signs, readable text or watermark"
    elif modern_residential:
        composition_contract = "strictly follow the supplied full 2x2 depth-control silhouette and orthographic 2.5D isometric view; centered; all four foundation corners remain visible; exactly five connected vertically aligned residential storeys, the glass lobby, four attached balconies, flat parapet roof, low mechanical penthouse and two solar panels follow the authored axes; no perspective convergence"
        negative_contract = "one compact five-storey modern residential apartment building only; no office tower, corporate lobby signage, commercial curtain-wall grid, medieval half-timber facade, pitched roof, sixth floor, inhabited roof tower, antenna mast, satellite dish, detached annex, second building, skybridge, road, cars, plaza furniture, people, animals, readable text or watermark"
    elif future_residential:
        composition_contract = "strictly follow the supplied full 2x2 depth-control silhouette and orthographic 2.5D isometric view; centered; all four foundation corners remain visible; exactly six independently readable curved elliptical residential floors retain their alternating offsets and rotations around one continuous oval tower core; preserve the curved glass ribbons, exactly three attached crescent sky gardens at levels two, four and six, one observation crown, one compact energy halo and four solar petals; no perspective convergence"
        negative_contract = "one connected six-level curved future ecological residential tower with exactly one closed flush ground-level bi-parting automatic entrance only; no round porthole window, capsule window, circular hatch, upper-floor opening, upper-floor arch, upper-floor door, duplicated portal or pod-like facade attachment; no open entrance gap, luminous threshold, glowing ramp, bridge, stairs or projecting platform; do not rectangularize any floor into a straight slab block; no seventh floor, second tower, detached pod, floating garden, flying vehicle, skybridge, antenna forest, industrial pipes, medieval half-timber facade, Gothic spire, neon billboard, glossy chrome, road, cars, plaza furniture, people, animals, readable text or watermark"
    else:
        composition_contract = "strictly follow the supplied depth-control silhouette and its orthographic 2.5D isometric view; centered; architecture ends exactly at the supplied ground line; all walls remain vertical; no perspective convergence"
        negative_contract = "no plumbing, pipes, water tubes, steam pipes, laboratory tubing, modern utilities, contemporary fixtures, industrial conduits, antennas, satellite dishes, exposed machinery or futuristic parts unless explicitly authored for this asset; no flat rooftop terrace, elevated deck, raised square platform, roof plaza or detached upper block; the upper tower must sit directly on the supplied roof mass; one building and exactly one routed low foundation plinth only; no second slab, oversized podium, detached platform, terrain patch, grass, trees, stairs, fence, props outside the architecture, people, animals, flags, text or watermark; the required foundation must stay completely inside the supplied footprint with transparent pixels outside it, and must not become white marble, a pale decorative skirt, a floor tile beyond the footprint or a cast shadow"
    style_version, _style_template, canonical_style_contract = style_contract_for(manifest)
    foundation_style, foundation_contract = foundation_contract_for(asset)
    class_style_contract = ""
    if modern_military_training_range:
        class_style_contract = """Canonical World-122 modern-military-training-range rendering subset:
Style/medium: sober semi-realistic present-day tactical training facility with physically plausible game-ready PBR materials and clean readable engineering.
Material grammar: worn reinforced concrete, dark olive painted equipment, charcoal structural steel, restrained blue-green control glass, dull aged brass hardware and small muted safety indicators.
Color treatment: deliberately low saturation and controlled neutral contrast; safety accents remain small and functional, never neon or insignia-like.
Lighting: soft neutral upper-left top-side illumination with restrained contact occlusion only; absolutely no cast shadow outside the body or foundation.
Detail scale: prioritize the single uninterrupted roof, attached control room, three lanes, three steel targets, connected backstop and ordered ammunition storage; avoid tiny controls, loose clutter and photographic micro-scratches.
Absolute class lock: this is one compact modern firing range, not a bunker complex, barracks, checkpoint, vehicle yard, radar site or futuristic weapons facility."""
    elif solar_power_station:
        class_style_contract = """Canonical World-122 photovoltaic-station rendering subset:
Style/medium: sober semi-realistic handcrafted modern renewable-energy facility with physically plausible game-ready PBR materials, clean readable engineering and the established World-122 isometric finish.
Material grammar: weathered light-gray concrete and mineral plaster, charcoal structural steel and panel frames, restrained deep navy-blue photovoltaic glass with broad visible cell divisions, subdued blue-green office glass, naturally aged brass for the geometric sun emblem and tiny cyan status lights limited to the attached inverter cabinets.
Color treatment: deliberately low saturation and controlled neutral contrast; blue glass, aged brass and cyan indicators are functional accents, never mirror-glossy, neon or corporate-bright.
Lighting: soft neutral upper-left top-side illumination with broad gentle highlights and restrained contact occlusion; no bloom, colored grading, rim light, glow haze or cast shadow.
Detail scale: prioritize the complete aligned panel field, repeated broad panel-cell divisions, one exact two-storey office, four roof panels, two attached inverter cabinets and one geometric no-text sun emblem; avoid hairline wiring and photographic micro-reflections.
Shape treatment: preserve the full low 4x4 station footprint and the authored common panel lattice; all frames remain parallel, equally pitched and regularly spaced around one compact flat-roof office.
Absolute class lock: this object is one modern photovoltaic power station, not a medieval half-timber building, Gothic monument, futuristic megastructure, wind farm, thermal plant, office tower or landscaped campus."""
    elif modern_data_center:
        class_style_contract = """Canonical World-122 modern-data-center rendering subset:
Style/medium: sober semi-realistic handcrafted modern computing facility with physically plausible game-ready PBR materials, clean readable engineering and the established World-122 isometric finish.
Material grammar: weathered cool-gray concrete and mineral panels, charcoal structural steel and server louvers, restrained deep blue-green server and operations glass, naturally aged brass, controlled cyan limited to coolant and status surfaces.
Color treatment: deliberately low saturation and controlled neutral contrast; glass, aged brass and cyan coolant are functional accents, never mirror-glossy, neon or corporate-bright.
Lighting: soft neutral upper-left top-side illumination with broad gentle highlights and restrained contact occlusion; no bloom, colored grading, rim light, glow haze or cast shadow.
Detail scale: prioritize the exact four central floors, two two-storey server wings, broad lobby, repeated server windows and intake grilles, two three-cassette cooling banks, two attached coolant tanks, paired low trunks, central manifold and one nine-node processor emblem; avoid loose racks and tiny sci-fi greebles.
Shape treatment: preserve one connected broad 4x4 facility with a central vertical operations core and lower symmetrical wings; all cooling devices stay physically attached and the silhouette remains compact rather than skyscraper-like.
Absolute class lock: this object is one modern data center, not a medieval half-timber building, Gothic monument, office skyscraper, futuristic megastructure, cooling plant or landscaped campus; no pitched roof, antenna, satellite dish, tower, detached annex, cars, text, chrome or floating machinery."""
    elif modern_field_barracks:
        class_style_contract = """Canonical World-122 modern-field-barracks rendering subset:
PRIMARY MATERIAL AND LIGHTING LOCK: render the authored modern military camp with next-generation physically plausible PBR material response optimized for strategy-game readability. This PBR and lighting language is the main style target, not optional polish and not photoreal military photography.
Style/medium: sober semi-realistic handcrafted present-day military field architecture with clean readable massing, slightly stylized solid game-scale proportions and the established World-122 isometric finish.
Material grammar: low-saturation olive-drab and dark forest canvas shows broad woven fibers, seams, restrained stains and practical service wear; dark webbing stays matte; charcoal structural steel shows believable edge wear and subdued oxidation; the authored concrete or stone footing retains natural medium-scale weathering, mineral variation and chipped edges without photographic micro-noise; authored wooden crate boards or timber fittings show visible grain, joints and restrained wear from repeated handling; sparse brass buckles, hinges and equipment fittings show naturally aged tarnish or muted verdigris, never glossy yellow gold. Muted khaki sandbag cloth, restrained deep-green glass and sparse warm amber utility light complete the material family.
Material boundary: apply stone weathering, worn wood and aged brass only to the foundation, crates and small fittings already present in the authored structure. Do not invent stone walls, half-timber architecture, Gothic ornament, decorative brass panels or extra props to demonstrate these materials.
Color treatment: deliberately low saturation and controlled neutral contrast; olive, khaki and amber are functional accents, never bright toy green, glossy, neon or national-color branding.
Equipment grammar: retain the authored ammunition crates, jerry cans, field radio and cable spool as three compact, orderly work zones with worn olive paint and dark hardware; keep the entrance and fixed ladder visibly unobstructed and do not scatter extra props.
Lighting: soft neutral upper-left top-side illumination with broad gentle highlights and restrained contact occlusion, balancing immediate building recognition with believable PBR surface response. Use no exaggerated bright-dark contrast, hard directional shadow, cinematic rim light, colored grading, bloom, glow haze or cast shadow outside the building body.
Detail scale: prioritize one large complete ridge tent, its open tied-back entrance and rolled windows, one open four-post lookout tower, cross braces, observation deck, rails, fixed ladder, small canvas canopy, two low sandbag stacks and one short connector; avoid hairline ropes and photographic micro-clutter.
Shape treatment: preserve a compact grounded 2x2 field compound with the tent as the dominant low mass and the single tower as the only vertical landmark; every structural part stays robust, attached and readable at RTS scale.
Absolute class lock: this object is one modern infantry field barracks, not a medieval half-timber building, castle, training obstacle course, fortified bunker, vehicle base, radar site or sci-fi outpost. Use no red tile, Gothic ornament, second tent, second tower, perimeter fence, barbed wire, camouflage-net canopy, vehicle, soldier, flag, logo or readable text."""
    elif roman_barracks:
        class_style_contract = """Canonical World-122 Roman-barracks rendering subset:
Style/medium: sober semi-realistic handcrafted late-Roman to medieval frontier military architecture with physically plausible game-ready PBR materials, clean readable fortified massing and the established World-122 isometric finish.
Material grammar: low-saturation weathered limestone and darker fieldstone, warm earth mineral plaster, a flat stone roof deck, dark oak gates, blackened iron, naturally aged brass and deep crimson legion cloth.
Color treatment: deliberately low saturation and controlled neutral contrast; crimson and aged brass form one restrained military accent family, never bright toy red, glossy gold, national-color branding or neon.
Lighting: soft neutral upper-left top-side illumination with broad gentle highlights and restrained contact occlusion; no bloom, colored grading, rim light, glow haze or cast shadow.
Detail scale: prioritize the low hall, one complete flat roof deck with low parapets, two flat crenellated towers, connected curtain wall, central arched gatehouse, broad battlements, two matching scuta and exactly two readable legion standards; keep stone courses, roof edging, flag trim and shield fittings broad enough for RTS scale.
Shape treatment: preserve one compact grounded 2x2 Roman fort-barracks with a horizontal hall and symmetrical fortified front; all walls, towers and gatehouse remain connected and the flat battlement skyline stays distinct from Gothic castle spires.
Absolute class lock: this object is one medieval Roman legion barracks, not a generic half-timber castle, Gothic church, fantasy citadel, classical temple, palace, amphitheater or modern base. Use no pitched roof, gable roof, roof tiles, pointed tower roofs, third tower, extra building, giant columns, siege engines, soldiers, extra flags, readable Latin text or national emblems."""
    elif victorian_residential:
        class_style_contract = """Canonical World-122 Victorian-residential rendering subset:
Style/medium: sober semi-realistic handcrafted late-nineteenth-century residential architecture with physically plausible game-ready PBR materials, readable massing and the established World-122 isometric finish.
Material grammar: low-saturation deep red-brown brick, warm aged cream dressed stone and mineral plaster, dark walnut timber, charcoal wrought iron, naturally oxidized copper and old brass, muted blue-gray slate, restrained amber residential glass.
Color treatment: deliberately low saturation and controlled neutral contrast; amber, brass and copper are small aged accents, never glossy or neon.
Lighting: soft neutral upper-left top-side illumination with broad gentle highlights and restrained contact occlusion; no bloom, colored grading, rim light, glow haze or cast shadow.
Detail scale: prioritize four readable storeys, one two-storey bay, one balcony, one domestic steam riser, one dormer and one chimney; keep brick courses and ironwork broad enough to read at game scale.
Shape treatment: one elegant compact connected townhouse on a complete 2x2 foundation, transitioning naturally from the established LV4 house through richer masonry, ironwork and restrained domestic steam technology.
Absolute class lock: this object is an inhabited Victorian steam-era residence, not a medieval half-timber house, factory, boiler hall, palace or industrial plant."""
    elif modern_residential:
        class_style_contract = """Canonical World-122 modern-residential rendering subset:
Style/medium: sober semi-realistic handcrafted modern apartment architecture with physically plausible game-ready PBR materials, clean readable massing and the established World-122 isometric finish.
Material grammar: weathered warm-gray concrete and mineral plaster, charcoal structural steel and slab bands, restrained blue-green residential glass, muted bronze trim, warm timber accents and sparse deep-green balcony planting.
Color treatment: deliberately low saturation and controlled neutral contrast; glass, bronze and vegetation are restrained functional accents, never glossy, neon or corporate-bright.
Lighting: soft neutral upper-left top-side illumination with broad gentle highlights and restrained contact occlusion; no bloom, colored grading, rim light, glow haze or cast shadow.
Detail scale: prioritize five readable storeys, a broad domestic lobby, repeated apartment windows, four attached balconies, flat parapet roof, low mechanical penthouse and two solar panels; avoid hairline glazing grids.
Shape treatment: one compact connected five-storey apartment building on a complete 2x2 foundation, visibly modernized from LV5 while retaining tactile weathering and robust game-readable proportions.
Absolute class lock: this object is a modern residence, not an office headquarters, glass skyscraper, medieval house, factory or futuristic megastructure."""
    elif future_residential:
        class_style_contract = """Canonical World-122 future-residential rendering subset:
Style/medium: sober semi-realistic handcrafted near-future ecological residential architecture with physically plausible game-ready PBR materials, sculptural readable curves and the established World-122 isometric finish.
Material grammar: warm off-white ceramic composite shells, charcoal structural bands, restrained blue-green and muted cyan residential glass, aged champagne-bronze joints, deep-green planted terraces and dark soil contained inside authored crescent gardens.
Color treatment: deliberately low saturation and controlled neutral contrast; cyan is limited to glass and subtle energy hardware, with no bloom, neon wash or mirror chrome.
Lighting: soft neutral upper-left top-side illumination with broad gentle highlights and restrained contact occlusion; no colored grading, rim light, glow haze or cast shadow.
Detail scale: prioritize six independently readable curved floors, their alternating offsets, one central oval core, three crescent gardens, curved glazing, one observation crown, one compact energy halo and four solar petals; avoid tiny sci-fi greebles.
Shape treatment: preserve physical convex and concave floor arcs and continuous structural connections; the tower must read as an inhabitable vertical garden rather than stacked rectangular plates or floating pods.
Absolute class lock: this object is one connected future ecological residence, not a corporate tower, space station, fantasy palace, second tower or collection of floating modules."""
    elif agricultural_compound:
        class_style_contract = """Canonical World-122 agricultural-compound rendering subset:
Style/medium: sober semi-realistic handcrafted medieval strategy-game agricultural building with physically plausible game-ready PBR materials and slightly stylized readable proportions.
Material grammar: a broad low dusty-olive pasture; weathered dark-oak post-and-rail fence; warm gray fieldstone; muted cream mineral plaster; subdued terracotta roof tile; dry straw thatch; charcoal iron; restrained old brass; natural golden cheese rind and sparse amber interior light.
Color treatment: deliberately low saturation and controlled neutral contrast; grass, terracotta and cheese are muted functional colors, never neon or glossy.
Lighting: soft neutral upper-left top-side illumination with broad gentle highlights and restrained contact occlusion; no bloom, colored grading, rim light, glow haze or cast shadow.
Detail scale: prioritize medium and large compound details that remain legible at game scale: complete fence rails and posts, open gate, three small roof masses, cowshed stall opening and trough, workshop press and aging rack, and the broad open pasture.
Shape treatment: preserve the authored low 4x4 ground plane and exact small-building proportions; fences stay thin and continuous, roofs stay complete, all structures remain grounded and separated from the open grazing area.
Absolute class lock: this object is one medieval cheese-farm compound, not a compact single building, castle, industrial facility, village cluster or scenery illustration. Do not invent animals, workers, vehicles, fields, trees or extra architecture."""
    elif wind_power_station:
        class_style_contract = """Canonical World-122 wind-power-station static-body rendering subset:
Style/medium: sober semi-realistic handcrafted medieval magitech strategy-game industrial architecture with physically plausible game-ready PBR materials, readable compact massing and the established World-122 isometric finish.
Material grammar: weathered cool-gray fieldstone, aged taupe mineral plaster, worn very dark oak framing, muted blue-gray slate, charcoal-blackened riveted iron lattice, naturally oxidized old brass machinery and restrained cyan-blue energy visible only inside exactly two attached buffers.
Color treatment: deliberately low saturation and controlled neutral contrast; cyan-blue and old brass are limited functional accents, never neon or glossy.
Lighting: soft neutral upper-left top-side illumination with broad gentle highlights and restrained contact occlusion only; absolutely no cast shadow, ground shadow, backdrop shadow or green-screen shadow gradient.
Detail scale: prioritize the low hall, short open tower, complete cross braces, horizontal nacelle, empty fixed axle collar, side flywheel, transfer shaft and two energy buffers; keep every component broad enough for RTS scale.
Shape treatment: preserve the exact compact 2x2 Blender silhouette and fixed isometric camera; the low generator hall remains the dominant mass and the short tower is the only vertical landmark.
Absolute class lock: this object is one static wind power station body prepared for a separate approved animated rotor layer. The top axle must remain empty: generate no blade, rotor, propeller, sail or wheel on it."""
    elif deep_drill:
        class_style_contract = """Canonical World-122 open industrial-building rendering subset:
Style/medium: sober semi-realistic handcrafted medieval strategy-game building with physically plausible game-ready PBR materials and slightly stylized readable proportions.
Material grammar: heavy weathered dark oak derrick posts and braces, charcoal-blackened wrought iron machinery, cool-gray worn stone machine deck, naturally oxidized old brass collars and gears, muted blue-gray roof covering and restrained cyan-blue energy visible only inside the bore and attached extraction cells.
Color treatment: deliberately low saturation and controlled neutral contrast; cyan-blue and old brass are limited functional accents, never neon or glossy.
Lighting: soft neutral upper-left top-side illumination with broad gentle highlights and restrained contact occlusion; no bloom, colored grading, rim light, glow haze or cast shadow.
Detail scale: prioritize medium and large mechanical details that remain legible at 48 pixels: four timber posts, cross braces, one roof canopy, one bore collar, one shaft, one side flywheel and drum, one extraction manifold, one tool chest, bundled spare pipes and spare drill bits.
Shape treatment: preserve the open frame and clean orthographic silhouette; components are rugged and attached, with restrained bevels and wear rather than modern precision engineering.
Absolute class lock: this object is an open medieval magitech deep-drilling economic building, not a house, enclosed factory, oil pumpjack, modern drilling tower or detached machinery yard."""
    elif surface_deposit:
        # Ground deposits need the common material/lighting response without the
        # building or mine-cave vocabulary.  Negating those concepts after the
        # full architecture prompt is unreliable and caused cave entrances,
        # timber supports and rails to appear in energy-vein drafts.
        class_style_contract = """Canonical World-122 ground-deposit rendering subset:
Style/medium: sober semi-realistic handcrafted strategy-game ground resource with physically plausible game-ready PBR materials and slightly stylized readable proportions.
Material grammar: low fractured charcoal and cool-gray stone, dusty rubble and broad flat mineral faces partially buried in the ground. Energy is visible only through restrained cyan-blue ore surfaces and narrow seams; it is never a liquid waterfall, portal or upright crystal.
Color treatment: deliberately low saturation and controlled neutral contrast; cyan-blue is a limited resource accent rather than a full glowing terrain mass.
Lighting: soft neutral upper-left top-side illumination with broad gentle highlights and restrained contact occlusion; no bloom, colored grading, rim light, glow haze or cast shadow.
Detail scale: prioritize medium and large ground details that remain legible at 48 pixels: the complete diamond boundary, rubble clusters, flat ore faces and fissure layout. Avoid hairline cracks and photographic gravel noise.
Shape treatment: a very shallow footprint-following bed with irregular natural edges and low embedded pieces; no vertical focal mass, raised slab, architectural base or detached scenery.
Absolute class lock: this object is a bare exposed surface mineral deposit, not a mine entrance, cave, building, ruin, platform or piece of infrastructure. Use no arches, portals, holes, walls, roofs, towers, timber framing, rails, carts or machinery."""
    elif modern_office:
        # Modern office buildings are an explicit, narrow World-122 variant.
        # They keep the shared material/lighting/readability rules; architecture
        # remains entirely defined by the authored model and asset manifest.
        class_style_contract = """Canonical World-122 modern-office rendering subset:
Style/medium: sober semi-realistic handcrafted strategy-game financial office building with physically plausible game-ready PBR materials, clean readable massing and slightly stylized robust proportions.
Material grammar: weathered cool-gray dressed stone at the podium; pale mineral concrete-plaster wall panels; charcoal structural steel mullions and slab bands; naturally aged old brass hardware; restrained deep blue-green office glass, sparse amber lobby glass and dim interior office light.
Color treatment: deliberately low saturation and controlled neutral contrast; blue-green, amber and muted green indicators are limited functional accents, never neon, glossy or full-screen emissive.
Lighting: soft neutral upper-left top-side illumination with broad gentle highlights and restrained contact occlusion; no bloom, colored grading, rim light, glow haze or cast shadow.
Detail scale: prioritize medium and large office details that remain legible at game scale: six aligned slab bands, repeated curtain-wall bays, one broad lobby, dark corner fins, one flat parapet roof, one fixed geometric market sign and one readable roof-mounted lattice antenna silhouette. Avoid hairline curtain-wall grids and photographic micro-reflections.
Shape treatment: one closed six-storey rectangular office block on a complete 4x4 foundation, plus one compact open steel communications antenna tower bolted to the low roof crown; restrained bevels and weathering integrate its modern vocabulary with World-122 without converting it into medieval timber architecture or a futuristic skyscraper.
Absolute class lock: this object is one modern-fantasy stock exchange office building with exactly one authored roof antenna tower. Use no half-timber braces, pitched roof, inhabited tower, spire, second antenna tower, detached annex, vehicle, street furniture, corporate wordmark, readable ticker, real-world logo or sci-fi machinery."""
    elif prop_asset:
        # Portable props keep the canonical material/lighting finish while their
        # category and geometry remain entirely defined by the asset contract.
        class_style_contract = """Canonical World-122 portable-prop rendering subset:
Style/medium: sober semi-realistic handcrafted strategy-game prop with physically plausible game-ready PBR materials and slightly stylized solid proportions.
Material grammar: charcoal-blackened steel panels show broad subtle wear and restrained value variation; aged brass frame, lock, hinges, medallion, filigree and handle show subdued tarnish and readable bevels, never glossy yellow gold. The empty interior is matte nearly black.
Color treatment: deliberately low saturation and controlled neutral contrast; charcoal, dark neutral steel and old brass only.
Lighting: soft neutral upper-left top-side illumination with broad gentle highlights and restrained contact occlusion; no bloom, colored grading, rim light, glow haze or cast shadow.
Detail scale: prioritize medium and large prop details that remain legible at 48 pixels: continuous frame bands, domed lid ribs, one lock plate, one lid medallion, broad embossed relief, hinges and one side handle. Avoid hairline ornament and photographic grime.
Shape treatment: crisp but not razor-sharp silhouette, restrained bevels and modest edge wear; no toy plastic, painterly brushwork, cel shading or cartoon outline.
Absolute class lock: this object is a portable metal treasure chest, not architecture. Use no masonry, plaster, timber framing, stained glass, windows, doors, walls, roofs, towers, buttresses, rooms or building foundations."""
    local_refine_contract = ""
    if stage == "refine" and masked_refine:
        local_refine_contract = """Local masked-refinement contract: regenerate only the white/red mask regions and preserve every unmasked pixel, silhouette, opening, component position, material value, lighting value and green backdrop exactly. Apply the primary request only inside the mask; do not spread the correction or reinterpret adjacent architecture.
"""
    return f"""Use case: stylized-concept
Asset type: {asset_type}, previewed above the {footprint_contract}
Pipeline/style version: {style_version}
Primary request: {request_prefix}{request}
{stage_contract}
{local_refine_contract}{palette_contract}{canonical_style_contract}
Foundation style id: {foundation_style}
{foundation_contract}
{class_style_contract}
{style_scope}
Composition/framing: {composition_contract}
Lighting/mood: soft neutral upper-left top-side illumination with broad gentle highlights and restrained contact occlusion limited to attached structural contacts; balance immediate building recognition with believable realistic PBR surface response; no bloom; generate absolutely no cast shadow of any kind, no ground shadow, no backdrop shadow, no green-screen shadow gradient and no detached ambient shadow outside the authored building or plinth
Scene/backdrop: perfectly uniform flat chroma-key green #00FF00 background filling the entire canvas; no horizon; no texture; no scenery
Negative constraints: {negative_contract}
{negative_request}
"""


def load_spec(asset: dict, destination: Path) -> None:
    if asset.get("sourceSpec"):
        source = REPO / asset["sourceSpec"]
        data = json.loads(source.read_text(encoding="utf-8"))
    else:
        data = {}
    data.update({
        "elevation": 30,
        "azimuth": 0,
        "resolution": 1024,
        "bottom_y": 880,
        "max_width_frac": 0.80,
        "top_margin_px": 48,
        "center_on_origin": True,
        "footprint_fit_scale": FOOTPRINT_FIT_SCALE,
    })
    if asset.get("primitives"):
        data["primitives"] = json.loads(json.dumps(asset["primitives"]))
    overlap_z = float(asset.get("structuralOverlapZ", 0))
    if overlap_z > 0:
        _extend_upper_masses_downward(data, overlap_z)
    if asset.get("footprintMode", "square_2x2") == "square_2x2":
        _normalize_square_footprint(data)
    destination.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _extend_upper_masses_downward(data: dict, overlap_z: float) -> None:
    """Make upper whitebox masses intersect their supports instead of merely touching.

    Diffusion models interpret coplanar primitive contacts as ledges, voids or
    detached towers.  Extending only the bottom of non-grounded boxes/prisms
    gives the depth and edge controls an unambiguous continuous intersection
    while preserving the authored top height.
    """
    changed = 0
    for primitive in data.get("primitives") or []:
        if primitive.get("type") not in {"box", "prism"}:
            continue
        size = primitive.get("size")
        pos = primitive.get("pos")
        if not isinstance(size, list) or len(size) < 3 or not isinstance(pos, list) or len(pos) < 3:
            continue
        bottom_z = float(pos[2]) - float(size[2]) * 0.5
        if bottom_z <= 2.0:
            continue
        size[2] = float(size[2]) + overlap_z
        pos[2] = float(pos[2]) - overlap_z * 0.5
        changed += 1
    data["structural_overlap"] = {"extendedPrimitiveCount": changed, "overlapZ": overlap_z}


def _primitive_xy_bounds(primitive: dict) -> tuple[float, float, float, float] | None:
    pos = primitive.get("pos", [0, 0, 0])
    px, py = float(pos[0]), float(pos[1])
    kind = primitive.get("type")
    if kind in {"box", "prism"} and len(primitive.get("size", [])) >= 2:
        sx, sy = float(primitive["size"][0]), float(primitive["size"][1])
    elif kind in {"cylinder", "cone", "sphere"}:
        radius = float(primitive.get("radius1", primitive.get("radius", 0)))
        sx = sy = radius * 2.0
    else:
        return None
    # The depth whitebox uses a fixed 44.8° footprint rotation for World-122.
    # Use the rotated AABB so towers/offset wings are included in the square fit.
    angle = float((primitive.get("rot") or [0, 0, 44.8])[2])
    import math
    c, s = abs(math.cos(math.radians(angle))), abs(math.sin(math.radians(angle)))
    hx = (sx * c + sy * s) * 0.5
    hy = (sx * s + sy * c) * 0.5
    return px - hx, px + hx, py - hy, py + hy


def _normalize_square_footprint(data: dict) -> None:
    """Make the control whitebox square in world XY before Blender renders it.

    The runtime collision footprint is a fixed 2x2 square. A rectangular main hall
    cannot be repaired by a sprite translation, so make every ground-contacting
    architectural box/prism square in XY while leaving upper roofs, windows,
    doors, braces and decorative props untouched. This only changes the derived
    depth spec in scratch.
    """
    primitives = data.get("primitives") or []
    changed = 0
    for primitive in primitives:
        size = primitive.get("size")
        if primitive.get("type") not in {"box", "prism"}:
            continue
        if not isinstance(size, list) or len(size) < 3:
            continue
        # Only geometry that actually touches z=0 defines the placement
        # footprint.  Upper roofs and trim may stay rectangular; ground-level
        # wings and annexes must be square too, otherwise they still protrude
        # beyond the fixed 2x2 footprint after sprite masking.
        pos = primitive.get("pos") or [0, 0, 0]
        bottom_z = float(pos[2]) - float(size[2]) * 0.5
        if bottom_z > 2.0 or min(float(size[0]), float(size[1])) < 32:
            continue
        side = max(float(size[0]), float(size[1])) * float(data.get("footprint_fit_scale", FOOTPRINT_FIT_SCALE))
        if abs(float(size[0]) - float(size[1])) > 0.5:
            size[0] = side
            size[1] = side
            changed += 1
    data["square_footprint_normalization"] = {
        "squarePrimitiveCount": changed,
        "fitScale": float(data.get("footprint_fit_scale", FOOTPRINT_FIT_SCALE)),
    }


def generate_asset(asset: dict, manifest: dict, output_root: Path, variants: int, *,
                   stage: str = "legacy", init_image: Path | None = None,
                   edge_image: Path | None = None, mask_image: Path | None = None,
                   mask_channel: str = "red", steps_override: int | None = None,
                   denoise_override: float | None = None, seed_override: int | None = None,
                   use_edge_control: bool = False,
                   generation_timeout: int | None = None,
                   rebuild_derived: bool = False,
                   raw_only: bool = False) -> None:
    asset_dir = output_root / asset["id"]
    asset_dir.mkdir(parents=True, exist_ok=True)
    prompt_suffix = "" if stage == "legacy" else f"_{stage}"
    # Keep staged controls separate from legacy outputs.  Otherwise an older
    # cached whitebox can silently survive a manifest geometry change.
    spec = asset_dir / f"{asset['id']}{prompt_suffix}_depth_spec.json"
    depth = asset_dir / f"{asset['id']}{prompt_suffix}_depth.png"
    generated_edge = asset_dir / f"{asset['id']}{prompt_suffix}_edge.png"
    control_edge = edge_image or generated_edge
    prompt = asset_dir / f"{asset['id']}{prompt_suffix}_prompt.txt"
    load_spec(asset, spec)
    prompt.write_text(
        prompt_for(asset, manifest, stage, masked_refine=mask_image is not None),
        encoding="utf-8",
    )
    stage_control_image = (
        asset.get("refineControlImage") if stage == "refine" else None
    ) or asset.get("controlImage")
    if stage_control_image:
        source_depth = Path(stage_control_image)
        if not source_depth.is_absolute():
            source_depth = REPO / source_depth
        if not source_depth.is_file():
            raise FileNotFoundError(f"control image missing: {source_depth}")
        if source_depth.resolve() != depth.resolve():
            shutil.copy2(source_depth, depth)
        print(f"[{asset['id']} depth] using authored control {source_depth}", flush=True)
    elif not depth.exists():
        run([
            str(BLENDER), "--background", "--factory-startup", "--python",
            str(REPO / "tools/ai-gen/blender-depth-render.py"), "--", str(spec), str(depth),
        ], label=f"{asset['id']} depth")
    postprocess_depth = depth
    if asset.get("postprocessDepthImage"):
        postprocess_depth = Path(asset["postprocessDepthImage"])
        if not postprocess_depth.is_absolute():
            postprocess_depth = REPO / postprocess_depth
        if not postprocess_depth.is_file():
            raise FileNotFoundError(f"postprocess depth image missing: {postprocess_depth}")
    if stage != "legacy" and not control_edge.exists():
        run([
            str(COMFY_PY), str(REPO / "tools/ai-gen/make-world122-building-edge-control.py"),
            str(depth), str(control_edge),
        ], label=f"{asset['id']} edge")

    if stage == "legacy":
        steps = steps_override or int(manifest["steps"])
        depth_strength = float(manifest["strength"])
        edge_strength = None
        denoise = None
        mask_edge_pad = int(manifest.get("legacyMaskEdgePad", 3))
    elif stage == "structure":
        steps = steps_override or int(manifest.get("structureSteps", 12))
        depth_strength = float(manifest.get("structureDepthStrength", manifest.get("strength", 0.88)))
        edge_strength = float(manifest.get("structureEdgeStrength", 0.38))
        denoise = None
        mask_edge_pad = int(manifest.get("maskEdgePad", 16))
    else:
        steps = steps_override or int(manifest.get("refineSteps", 48))
        depth_strength = float(manifest.get("refineDepthStrength", 0.82))
        edge_strength = float(manifest.get("refineEdgeStrength", 0.38))
        denoise = (denoise_override if denoise_override is not None
                   else float(manifest.get("refineDenoise", 0.30)))
        mask_edge_pad = int(manifest.get("maskEdgePad", 16))
    mask_edge_pad = int(asset.get("maskEdgePad", mask_edge_pad))

    request_timeout = int(generation_timeout or manifest.get("generationTimeout", 3600))
    style_version, style_template, _style_contract = style_contract_for(manifest)
    cfg = float(manifest.get("cfg", 1.0))
    sampler = str(manifest.get("sampler", "euler"))
    scheduler = str(manifest.get("scheduler", "simple"))
    size = str(manifest.get("size", "1024x1024"))
    standard_steps = int(manifest.get(
        "structureSteps" if stage == "structure" else "refineSteps" if stage == "refine" else "steps",
        12 if stage == "structure" else 48))
    standard_denoise = float(manifest.get("refineDenoise", 0.30)) if stage == "refine" else None

    for variant in range(1, variants + 1):
        stage_tag = "" if stage == "legacy" else f"_{stage}"
        stem = f"{asset['id']}{stage_tag}_v{variant:02d}"
        raw = asset_dir / f"{stem}_raw.png"
        keyed = asset_dir / f"{stem}_keyed.png"
        cleaned = asset_dir / f"{stem}_cleaned.png"
        anchored = asset_dir / f"{stem}_anchored.png"
        final = asset_dir / f"{stem}_body.png"
        preview = asset_dir / f"{stem}_preview.png"
        generation_metadata = asset_dir / f"{stem}_generation.json"
        if preview.exists() and not rebuild_derived:
            print(f"[{asset['id']} v{variant:02d}] already complete; skipping", flush=True)
            continue
        if seed_override is not None:
            seed = seed_override + variant - 1
        else:
            seed_base = int(manifest.get(
                "refineSeedBase" if stage == "refine" else "structureSeedBase", 122200))
            seed = seed_base + (list_index[asset["id"]] * 10) + variant
        if not raw.exists():
            command = [
                str(COMFY_PY), str(REPO / "tools/ai-gen/comfyui-gen.py"),
                "--host", manifest["host"], "--model", manifest["model"],
                "--steps", str(steps), "--control-image", str(depth),
                "--cfg", str(cfg), "--sampler", sampler,
                "--scheduler", scheduler, "--size", size,
                "--bg-color", "#00FF00", "--seed", str(seed),
                "--prompt-file", str(prompt), "--out", str(raw),
                "--timeout", str(request_timeout),
            ]
            if stage == "legacy" or not use_edge_control:
                command.extend(["--strength", str(depth_strength)])
            else:
                command.extend([
                    "--control-image", str(control_edge),
                    "--control-strength", str(depth_strength),
                    "--control-strength", str(edge_strength),
                ])
            if stage == "refine":
                command.extend(["--init-image", str(init_image), "--denoise", str(denoise)])
                if mask_image:
                    command.extend(["--mask-image", str(mask_image),
                                    "--mask-channel", mask_channel])
            run(command, label=f"{asset['id']} {stage} v{variant:02d} generate",
                timeout=request_timeout + 60)
        generation_metadata.write_text(json.dumps({
            "pipeline": "world122-building-candidates",
            "styleVersion": style_version,
            "styleTemplate": style_template,
            "assetId": asset["id"],
            "foundationStyle": foundation_style_for(asset),
            "stage": stage,
            "model": manifest["model"],
            "size": size,
            "steps": steps,
            "cfg": cfg,
            "sampler": sampler,
            "scheduler": scheduler,
            "depthStrength": depth_strength,
            "edgeControl": bool(stage != "legacy" and use_edge_control),
            "edgeStrength": edge_strength if stage != "legacy" and use_edge_control else None,
            "denoise": denoise,
            "seed": seed,
            "promptFile": str(prompt.relative_to(REPO)) if prompt.is_relative_to(REPO) else str(prompt),
            "depthImage": str(depth.relative_to(REPO)) if depth.is_relative_to(REPO) else str(depth),
            "postprocessDepthImage": (str(postprocess_depth.relative_to(REPO))
                                      if postprocess_depth.is_relative_to(REPO) else str(postprocess_depth)),
            "initImage": str(init_image) if init_image else None,
            "maskImage": str(mask_image) if mask_image else None,
            "maskChannel": mask_channel if mask_image else None,
            "localMaskedRefine": bool(mask_image),
            "rawOnly": bool(raw_only),
            "nonstandardOverride": bool(
                steps != standard_steps
                or (stage == "refine" and abs(float(denoise) - standard_denoise) > 1e-9)
            ),
        }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        if raw_only:
            print(
                f"[{asset['id']} v{variant:02d}] raw-only handoff; "
                "skipping key/anchor/mask/preview derivation",
                flush=True,
            )
            continue
        if rebuild_derived or not keyed.exists():
            key_command = [str(COMFY_PY), str(REPO / "tools/ai-gen/key-world122-building-body.py"),
                           str(raw), str(keyed)]
            if asset.get("keyThreshold") is not None:
                key_command.extend(["--threshold", str(float(asset["keyThreshold"]))])
            if asset.get("preserveHiddenKeyRgb"):
                key_command.append("--preserve-hidden-rgb")
            if asset.get("removeEnclosedKey"):
                key_command.append("--remove-enclosed-key")
            if asset.get("removeAllGreen"):
                key_command.append("--remove-all-green")
            run(key_command, label=f"{asset['id']} v{variant:02d} key")
        if rebuild_derived or not cleaned.exists():
            if asset.get("removePseudoPlinth"):
                run([str(COMFY_PY), str(REPO / "tools/ai-gen/remove-world122-building-pseudo-plinth.py"), str(keyed), str(cleaned)], label=f"{asset['id']} v{variant:02d} clean")
            else:
                shutil.copyfile(keyed, cleaned)
                print(f"[{asset['id']} v{variant:02d} clean] preserved authored foundation/ground contact -> {cleaned}", flush=True)
        if rebuild_derived or not anchored.exists():
            footprint_cells = int(asset.get("generationFootprintCells", asset.get("footprintCells", 2)))
            nominal_width = float(asset.get("nominalFootprintWidth", 128 * footprint_cells))
            nominal_height = float(asset.get("nominalFootprintHeight", 64 * footprint_cells))
            display_width = float(asset.get("previewDisplayWidth", nominal_width))
            display_height = float(asset.get("previewDisplayHeight", display_width))
            run([str(COMFY_PY), str(REPO / "tools/ai-gen/anchor-world122-building-body.py"), str(cleaned), str(postprocess_depth), str(anchored),
                 "--display-width", str(display_width), "--display-height", str(display_height),
                 "--nominal-width", str(nominal_width), "--nominal-height", str(nominal_height),
                 "--edge-pad", str(mask_edge_pad)],
                label=f"{asset['id']} v{variant:02d} anchor")
        if rebuild_derived or not final.exists():
            footprint_cells = int(asset.get("footprintCells", 2))
            generation_cells = int(asset.get("generationFootprintCells", footprint_cells))
            mask_command = [str(COMFY_PY), str(REPO / "tools/ai-gen/mask-world122-building-body.py"),
                            str(anchored), str(postprocess_depth), str(final), "--edge-pad", str(mask_edge_pad)]
            if asset.get("restoreModeledAlpha"):
                mask_command.append("--restore-modeled-alpha")
            if asset.get("restoreDeltaDepthImage"):
                restore_delta_depth = Path(asset["restoreDeltaDepthImage"])
                if not restore_delta_depth.is_absolute():
                    restore_delta_depth = REPO / restore_delta_depth
                if not restore_delta_depth.is_file():
                    raise FileNotFoundError(f"restore delta depth image missing: {restore_delta_depth}")
                mask_command.extend(["--restore-delta-depth", str(restore_delta_depth)])
            if asset.get("removeGreenOutsideRestore"):
                mask_command.append("--remove-green-outside-restore")
                if asset.get("restoreHalo") is not None:
                    mask_command.extend(["--restore-halo", str(int(asset["restoreHalo"]))])
            if generation_cells != footprint_cells:
                mask_command.extend(["--post-scale", str(footprint_cells / generation_cells)])
            if int(asset.get("minComponentPixels", 0)) > 0:
                mask_command.extend(["--min-component-pixels", str(int(asset["minComponentPixels"]))])
            run(mask_command,
                label=f"{asset['id']} v{variant:02d} mask")
        preview_command = [str(COMFY_PY), str(REPO / "tools/ai-gen/compose-world122-building-preview.py"),
                           str(final), str(preview),
                           "--footprint-cells", str(int(asset.get("footprintCells", 2)))]
        if asset.get("removeAllGreen"):
            preview_command.append("--remove-all-green")
        run(preview_command, label=f"{asset['id']} v{variant:02d} preview")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument(
        "--variants", type=int, default=None,
        help="candidate-count override; defaults are structure=3 and refine=2",
    )
    parser.add_argument("--only", nargs="*", default=None, help="asset ids to generate")
    parser.add_argument("--stage", choices=("legacy", "structure", "refine"), default="legacy",
                        help="legacy one-pass, 12-step structure draft, or img2img refinement")
    parser.add_argument("--init-image", type=Path,
                        help="selected structure image; required by --stage refine")
    parser.add_argument("--edge-image", type=Path,
                        help="optional authored edge control; defaults to edges derived from depth")
    parser.add_argument("--mask-image", type=Path,
                        help="optional local refine mask; white/red=regenerate, black=preserve")
    parser.add_argument("--mask-channel", choices=("alpha", "red", "green", "blue"),
                        default="red", help="channel read from --mask-image")
    parser.add_argument("--edge-control", action="store_true",
                        help="chain the derived edge map as a second ControlNet; requires a compatible remote plugin")
    parser.add_argument("--steps", type=int, help="override the selected stage's step count")
    parser.add_argument("--denoise", type=float, help="override refine img2img denoise")
    parser.add_argument("--seed", type=int, help="first candidate seed; subsequent variants increment it")
    parser.add_argument("--timeout", type=int,
                        help="per-image ComfyUI wait timeout in seconds; default from manifest")
    parser.add_argument("--rebuild-derived", action="store_true",
                        help="rebuild keyed/cleaned/anchored/body/preview files from existing raw images")
    parser.add_argument(
        "--raw-only", action="store_true",
        help="generate raw green-screen candidates and metadata only; skip all cutout/alpha derivation",
    )
    parser.add_argument("--allow-nonstandard", action="store_true",
                        help="allow step/denoise values outside the manifest contract; recorded in metadata")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    output_root = args.out or Path(manifest["outputRoot"])
    if args.stage == "structure":
        variants = args.variants or manifest.get("structureVariants", 3)
    elif args.stage == "refine":
        variants = args.variants or manifest.get("refineVariants", 2)
    else:
        variants = args.variants or manifest.get("variants", 2)
    selected = [a for a in manifest["assets"] if not args.only or a["id"] in args.only]
    if args.stage == "refine":
        if not args.init_image:
            parser.error("--stage refine requires --init-image")
        if not args.init_image.exists():
            parser.error(f"--init-image not found: {args.init_image}")
        if len(selected) != 1:
            parser.error("--stage refine requires exactly one selected asset via --only <asset_id>")
    if args.edge_image and not args.edge_image.exists():
        parser.error(f"--edge-image not found: {args.edge_image}")
    if args.mask_image and args.stage != "refine":
        parser.error("--mask-image is valid only with --stage refine")
    if args.mask_image and not args.mask_image.exists():
        parser.error(f"--mask-image not found: {args.mask_image}")
    if args.denoise is not None and args.stage != "refine":
        parser.error("--denoise is valid only with --stage refine")
    if args.denoise is not None and not 0.0 < args.denoise <= 1.0:
        parser.error("--denoise must be in (0,1]")
    expected_steps = (manifest.get("structureSteps", 12) if args.stage == "structure"
                      else manifest.get("refineSteps", 48) if args.stage == "refine"
                      else manifest.get("steps", 48))
    if args.steps is not None and args.steps != int(expected_steps) and not args.allow_nonstandard:
        parser.error(f"--steps {args.steps} breaks the standard {args.stage} contract "
                     f"({expected_steps}); add --allow-nonstandard for an explicitly recorded experiment")
    expected_denoise = float(manifest.get("refineDenoise", 0.30))
    if (args.denoise is not None and abs(args.denoise - expected_denoise) > 1e-9
            and not args.allow_nonstandard):
        parser.error(f"--denoise {args.denoise} breaks the standard refine contract "
                     f"({expected_denoise}); add --allow-nonstandard for an explicitly recorded experiment")
    if args.timeout is not None and args.timeout < 60:
        parser.error("--timeout must be at least 60 seconds")
    global list_index
    list_index = {a["id"]: i for i, a in enumerate(manifest["assets"])}
    if not COMFY_PY.exists():
        raise FileNotFoundError(f"ComfyUI Python missing: {COMFY_PY}")
    if not BLENDER.exists():
        raise FileNotFoundError(f"Blender missing: {BLENDER}")
    print(f"output={output_root} stage={args.stage} assets={len(selected)} variants={variants}", flush=True)
    for asset in selected:
        staged_asset = json.loads(json.dumps(asset))
        if args.stage != "legacy":
            staged_asset.setdefault(
                "structuralOverlapZ", manifest.get("structuralOverlapZ", 8))
        generate_asset(
            staged_asset, manifest, output_root, variants,
            stage=args.stage, init_image=args.init_image, edge_image=args.edge_image,
            mask_image=args.mask_image, mask_channel=args.mask_channel,
            steps_override=args.steps, denoise_override=args.denoise, seed_override=args.seed,
            use_edge_control=args.edge_control or bool(manifest.get("useEdgeControl", False)),
            generation_timeout=args.timeout,
            rebuild_derived=args.rebuild_derived,
            raw_only=args.raw_only,
        )
    print("all requested candidates complete", flush=True)


if __name__ == "__main__":
    main()
